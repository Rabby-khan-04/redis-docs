# Chapter 19 — Lua scripting

> **Verified on:** Redis **8.10.2**, node-redis **6.3.0**
> Run the code: `node examples/19-lua-scripting.mjs`

---

## 1. Simple explanation (like I'm 7)

"Only sell the last ticket — but only if there is one left."

If you do that in two steps, two people can both see "1 left" and both buy. Oops.

Redis can run your whole rule **inside itself, in one go**, so nobody can get in between.

It is like writing a tiny recipe and handing it to the shopkeeper. They read it once, do
every step, and hand back one answer.

---

## 2. Real name

**Lua scripting** lets you run a small program **inside** the Redis server, atomically.

A script runs to completion with **no other command in between** — like a transaction, but
you can put **logic** in it (loops, `if`, arithmetic), which a transaction cannot.

### Your script's variables

| Variable | What it is |
|---|---|
| `KEYS[1]`, `KEYS[2]`… | Key names, supplied by the caller |
| `ARGV[1]`, `ARGV[2]`… | Plain arguments, supplied by the caller |
| `redis.call(cmd, ...)` | Run a Redis command; **raises** an error on failure |
| `redis.pcall(cmd, ...)` | Run a command; **returns** the error instead |
| `redis.error_reply(msg)` | Return an error |
| `redis.status_reply(msg)` | Return a status |
| `redis.sha1hex(str)` | SHA-1 of a string |

### 🔴 The one rule that matters

**Never hardcode a key inside a script.** Always pass it via `KEYS`.

```lua
-- ✗ WRONG
redis.call('GET', 'session:fixed-key')

-- ✓ RIGHT
redis.call('GET', KEYS[1])
```

Redis needs to know which keys a script touches — in Cluster it must route to the right
node, and key-rewriting (for hash tags) must work.

### Commands

| Command | What it does |
|---|---|
| `EVAL script numkeys [key...] [arg...]` | Run the script |
| `EVALSHA sha1 numkeys ...` | Run a pre-loaded script by hash |
| `EVAL_RO` / `EVALSHA_RO` | Read-only variant (allowed on replicas) |
| `SCRIPT LOAD script` | Store a script, returns its SHA-1 |
| `SCRIPT EXISTS sha...` | Is it loaded? |
| `SCRIPT FLUSH` | Evict all scripts (`NOSCRIPT` afterwards) |
| `SCRIPT KILL` | Kill a running script |
| `SCRIPT DEBUG` | Trace / set a timeout |
| `FUNCTION LOAD` | Load as a **library** (Redis 7+) — survives `SCRIPT FLUSH` |

### 🔴 Scripts **block** the server

Redis is single-threaded ([Chapter 01](01-what-is-redis.md)). A running script is the same:
nothing else executes.

Verified: a script doing 3 million loop iterations ran for 23 ms, and an unrelated `GET` on
another connection took up to **18 ms** during that window (vs ~0.4 ms normally).

---

## 3. redis-cli example

```bash
docker exec -it redis-learn redis-cli
```

### A simple script

```redis
127.0.0.1:6379> SET n1 10
127.0.0.1:6379> SET n2 20
127.0.0.1:6379> EVAL "return redis.call('GET', KEYS[1]) + redis.call('GET', KEYS[2])" 2 n1 n2
(integer) 30
```

### SCRIPT LOAD + EVALSHA

```redis
127.0.0.1:6379> SCRIPT LOAD "return redis.call('GET', KEYS[1])"
"389f5651e91515d6..."
127.0.0.1:6379> EVALSHA 389f5651e91515d6 1 n1
"10"
127.0.0.1:6379> EVALSHA 0000000000000000000000000000000000000000 1 n1
(error) NOSCRIPT No matching script. Please use EVAL.
```

### The atomic conditional update

```redis
127.0.0.1:6379> SET stock 1
OK
127.0.0.1:6379> EVAL "if redis.call('GET',KEYS[1])=='1' then redis.call('SET',KEYS[1],'0'); return 1 else return 0 end" 1 stock
(integer) 1
127.0.0.1:6379> EVAL "if redis.call('GET',KEYS[1])=='1' then redis.call('SET',KEYS[1],'0'); return 1 else return 0 end" 1 stock
(integer) 0
```

Run those two lines 100 times in 100 parallel clients: **exactly one** gets `1`.

### A rate limiter with a guaranteed TTL

```redis
127.0.0.1:6379> EVAL "local c=redis.call('INCR',KEYS[1]) if c==1 then redis.call('EXPIRE',KEYS[1],tonumber(ARGV[1])) end return c" 1 rate:user1 10
(integer) 1
127.0.0.1:6379> EVAL "local c=redis.call('INCR',KEYS[1]) if c==1 then redis.call('EXPIRE',KEYS[1],tonumber(ARGV[1])) end return c" 1 rate:user1 10
(integer) 2
127.0.0.1:6379> TTL rate:user1
(integer) 10
```

The `INCR` and the `EXPIRE` happen atomically, so the counter can **never** leak without a
TTL. Doing this from your app would leave a window where the key has no expiry.

---

## 4. Node.js example

### Verified output of `examples/19-lua-scripting.mjs`

```
--- basics ---
empty script -> 0
sum of 3 keys -> 35 (a single atomic round trip)

--- ⚠️ KEYS and ARGV rules ---
  KEYS[1..n]  the key names, passed by the caller
  ARGV[1..n]  the arguments, passed by the caller
  ✗ NEVER hardcode a key inside the script.
    In Redis Cluster (and with key-tracking rewrites) that breaks.
demo -> 10:suffix

--- ⭐ atomic conditional update ---
50 concurrent claims on stock=1 -> 1 succeeded, 49 refused
  ^ EXACTLY ONE wins. Impossible with GET-then-SET in JS.
  stock is now 0

--- rate limiter in Lua ---
7 calls in one 10s window -> [ 1, 2, 3, 4, 5, 6, 7 ]
allowed (count <= 3): 3
TTL is 10 seconds
  ^ the INCR and the EXPIRE are atomic, so the key can never leak forever.

--- ⚠️ scripts block the server ---
one slow script ran for 23ms
unrelated GET during it: p50=0.44ms max=18.01ms
  ^ NOTHING else runs. Keep scripts tiny.

--- SCRIPT LOAD + EVALSHA ---
SCRIPT LOAD -> 389f5651e91515d6...
EVALSHA     -> 0

⚠️ node-redis 6 has NO defineScript() helper (it was removed).
  Use eval() / evalSha() / scriptLoad() directly and handle NOSCRIPT yourself:
  SCRIPT LOAD -> 389f5651e91515d6...
  EVALSHA claim -> 1
  EVALSHA claim -> 1

NOSCRIPT after a SCRIPT FLUSH:
  EVALSHA now  -> 0
  ^ the catch block reloaded the script transparently. Without it you would
    get: NOSCRIPT No matching script.

--- EVALSHA_RO (read-only, can run on replicas) ---
  Script config supports IS_READ_ONLY -> sends EVALSHA_RO instead of EVALSHA
  (only reachable via the low-level `scripts:` option in v6)

DBSIZE after cleanup: 0
```

### The API

```javascript
const result = await client.eval(scriptBody, {
  keys: ['stock'],        // becomes KEYS[1], KEYS[2], ...
  arguments: ['1'],       // becomes ARGV[1], ARGV[2], ...
});
```

### ⭐ 50 concurrent claims, exactly 1 winner

```javascript
const CLAIM = `
  local stock = tonumber(redis.call('GET', KEYS[1]) or '0')
  if stock <= 0 then return 0 end
  redis.call('DECRBY', KEYS[1], tonumber(ARGV[1]))
  return 1
`;

const results = await Promise.all(
  Array.from({ length: 50 }, () =>
    client.eval(CLAIM, { keys: ['stock'], arguments: ['1'] }))
);
```

Verified:

```
50 concurrent claims on stock=1 -> 1 succeeded, 49 refused
  stock is now 0
```

The equivalent JavaScript — `GET` then `DECRBY` — would let several callers through. This is
the standard, correct way to do a **distributed lock**, a **compare-and-set**, or a
**stock decrement**.

### The rate limiter that cannot leak

```javascript
const RATE = `
  local current = redis.call('INCR', KEYS[1])
  if current == 1 then
    redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
  end
  return current
`;
```

Verified:

```
7 calls in one 10s window -> [ 1, 2, 3, 4, 5, 6, 7 ]
allowed (count <= 3): 3
TTL is 10 seconds
```

From your app you would write `INCR` then, if it returned 1, `EXPIRE` — two round trips and
a window where a crash leaves a counter with **no TTL**, blocking that user forever. The
script makes it impossible.

### 🔴 Scripts block the server — measured

```
one slow script ran for 23ms
unrelated GET during it: p50=0.44ms max=18.01ms
```

A completely unrelated `GET` on another connection stalled up to **18 ms**. If a script takes
100 ms, the entire server is unusable for 100 ms. Keep scripts to a handful of commands.

### 🔴 `defineScript` is gone in node-redis 6

Verified: `client.defineScript is not a function`. In v6 you do it yourself:

```javascript
let cachedSha = await client.scriptLoad(CLAIM);

async function callClaim(keys, args) {
  try {
    return await client.evalSha(cachedSha, { keys, arguments: args });
  } catch (e) {
    if (e.message.includes('NOSCRIPT')) {
      cachedSha = await client.scriptLoad(CLAIM);     // reload once
      return await client.evalSha(cachedSha, { keys, arguments: args });
    }
    throw e;
  }
}
```

Verified:

```
NOSCRIPT after a SCRIPT FLUSH:
  EVALSHA now  -> 0
  ^ the catch block reloaded the script transparently.
```

The `scripts:` option in `createClient` exists but expects an **internal** shape
(`{ SHA1, NUMBER_OF_KEYS, parseCommand }`), not the friendly `{ LOAD, NUMBER_OF_KEYS }`
older docs show. Use `eval`/`evalSha` directly.

---

## 5. When to use it and when NOT to

### ✅ Use Lua when

- You need **read-then-write atomically** (compare-and-set, stock decrement, lock).
- You need **guaranteed pairing** (`INCR` + `EXPIRE` together).
- You want to **reduce round trips** for logic that needs the data.
- You need a **distributed lock** that cannot be stolen mid-check.
- You need **rate limiting** that cannot leak a key without a TTL.

### ❌ Don't use Lua when

| Situation | Why | Use instead |
|---|---|---|
| The script takes **milliseconds** | Blocks the whole server | Pipeline / transaction |
| You only need one command | Overhead for nothing | The command |
| Logic is complex | Hard to test and debug | Do it in your app |
| You need to iterate over **many keys** | Blocks everything | `SCAN` + pipeline |
| The result could be **huge** | Big memory spike | Aggregate server-side |

### EVAL vs transaction vs function

| | Transaction | Lua | Functions |
|---|---|---|---|
| Logic | ❌ | ✅ | ✅ |
| Atomic | ✅ | ✅ | ✅ |
| Always available | ✅ | ✅ | After `FUNCTION LOAD` |
| Survives `SCRIPT FLUSH` | n/a | ❌ | ✅ |
| Cluster routing | needs tags | needs keys | needs keys |

For library-style code that must survive a restart, use `FUNCTION LOAD`
([Chapter 21](21-persistence.md)) — `SCRIPT LOAD` is lost on restart and after
`SCRIPT FLUSH`.

---

## 6. Common mistakes

**Mistake 1 — Hardcoding keys.**
Breaks in Cluster and with key rewriting. Always use `KEYS[n]`.

**Mistake 2 — Long-running scripts.**
Verified: a 23 ms script stalled unrelated `GET`s by 18 ms. Keep scripts tiny.

**Mistake 3 — Using `redis.call` when you want to handle failure.**
`redis.call` **raises**, aborting the whole script. Use `redis.pcall` to inspect the error.

**Mistake 4 — Assuming rollback.**
If a script errors halfway, **earlier writes stay**. Scripts are not transactional.

**Mistake 5 — Not handling `NOSCRIPT`.**
Verified: after `SCRIPT FLUSH`, `EVALSHA` throws `NOSCRIPT No matching script`. Catch and
reload — or just use `EVAL`.

**Mistake 6 — Shipping the script text on every call.**
`EVAL` sends the whole body each time. Use `SCRIPT LOAD` + `EVALSHA`.

**Mistake 7 — `EVALSHA` on a replica with a writing script.**
Write scripts only run on the primary. Use `EVAL_RO` / `EVALSHA_RO` for read-only scripts.

**Mistake 8 — Converting numbers with `+` instead of `tonumber`.**
Lua is not Node: `redis.call('GET', k)` returns a **string**. Verified: `sum + tonumber(v)`.

**Mistake 9 — Returning Lua tables that Redis can't convert.**
Return scalars, or arrays of scalars. A mixed/cyclic table errors.

**Mistake 10 — Treating a script as a security boundary.**
Scripts run with full access. Don't run user-supplied Lua.

---

## 7. Try it yourself

**Exercise:** Write a Lua script that implements a **correct** "if balance >= amount,
deduct, else refuse" operation, then fire 100 concurrent attempts at it with the balance
deliberately set just above the amount. Then write the naïve JavaScript version and run the
same test.

**Hint:** `KEYS = [account]`, `ARGV = [amount]`. Script: `if tonumber(redis.call('GET',
KEYS[1])) >= tonumber(ARGV[1]) then redis.call('DECRBY', KEYS[1], ARGV[1]); return 1 else
return 0 end`.

**What to notice:** the Lua version lets exactly `floor(balance / amount)` succeed. The
naïve version (`GET`, compare in JS, `DECRBY`) will let the balance go **negative** under
concurrency, because every caller reads the same pre-update balance.

**Stretch:** make the script also `DECRBY` a global counter atomically, so the total taken is
also correct.

---

## 8. Next

**[Chapter 20 — Pub/Sub](20-pub-sub.md)** — sending live notifications between parts of your
system.

---

**Verified facts recap**

| Claim | How verified |
|---|---|
| 50 concurrent Lua claims → exactly **1** winner | Verified |
| Lua rate limiter: `INCR` + `EXPIRE` atomic | `[1..7]`, TTL 10 |
| Script blocked unrelated `GET` up to **18 ms** | Concurrent-connection test |
| `client.defineScript` does not exist in v6 | `TypeError` |
| `SCRIPT LOAD` returns a SHA-1 | `389f5651e91515d6...` |
| `SCRIPT FLUSH` → `EVALSHA` throws `NOSCRIPT` | Caught, reloaded |
| `KEYS`/`ARGV` pass key and args | `10:suffix` |
| Sum of 3 keys in **one** round trip | `35` |