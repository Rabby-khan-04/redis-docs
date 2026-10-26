# Chapter 17 — Transactions (MULTI/EXEC)

> **Verified on:** Redis **8.10.2**, node-redis **6.3.0**
> Run the code: `node examples/17-transactions.mjs`

---

## 1. Simple explanation (like I'm 7)

Imagine you want to **move 30 coins** from Alice's purse to Bob's.

Doing it in two steps is dangerous:

1. Take 30 from Alice.
2. **💥 The computer crashes.**
3. Bob never gets the coins. They vanished.

A **transaction** says: *"do both steps, and nobody may look in between."* Nobody can see
the moment when Alice's money has left but Bob's hasn't arrived. It's all-or-nothing from
the outside.

---

## 2. Real name

**Redis transactions** are a `MULTI` … `EXEC` pair:

1. `MULTI` — start queuing. Commands are **not run yet**.
2. Queue as many commands as you like.
3. `EXEC` — run them all, back to back, with **nothing else in between**.

### 🔴 Three things most people get wrong

| Belief | Reality |
|---|---|
| "If one command fails, they all roll back" | **There is no rollback.** Verified. |
| "It validates commands before running" | It only checks *syntax* at queue time. |
| "It's like a SQL transaction" | Not ACID — no isolation from reads during `EXEC`, no rollback. |

### Commands

| Command | What it does |
|---|---|
| `MULTI` | Start queueing |
| `EXEC` | Run the queue |
| `DISCARD` | Throw the queue away, run nothing |
| `WATCH key...` | Abort if any of these keys change before `EXEC` |
| `UNWATCH` | Stop watching |

### node-redis 6 specifics

```javascript
const replies = await client.multi()
  .set('k', 'v')
  .incr('counter')
  .get('other')
  .exec();
```

- `exec()` **throws `MultiErrorReply`** if any command failed, carrying `.replies` and
  `.errorIndexes`.
- On success, replies are **raw values** (`'OK'`, `1`, `'2'`) — **not** `{ok: true}`
  wrappers under RESP3.
- `WATCH` is a **top-level** client command: `await client.watch(key)`, not chained off
  `multi()`.

---

## 3. redis-cli example

```bash
docker exec -it redis-learn redis-cli
```

```redis
127.0.0.1:6379> SET a 1
127.0.0.1:6379> SET b 2
127.0.0.1:6379> MULTI
OK
127.0.0.1:6379> SET a 10
QUEUED
127.0.0.1:6379> INCR counter
QUEUED
127.0.0.1:6379> GET b
QUEUED
127.0.0.1:6379> EXEC
1) "OK"
2) (integer) 1
3) "2"
```

Note you get `QUEUED` for each command — proof nothing has run yet.

### 🔴 No rollback — demonstrated

```redis
127.0.0.1:6379> SET good "i am a string"
OK
127.0.0.1:6379> MULTI
OK
127.0.0.1:6379> SET first "this WILL be written"
QUEUED
127.0.0.1:6379> LPUSH good x
QUEUED                      ← accepted at queue time! it is syntactically valid
127.0.0.1:6379> INCR good
QUEUED
127.0.0.1:6379> EXEC
1) "OK"                                       ← succeeded
2) (error) WRONGTYPE Operation against a key holding the wrong kind of value
3) (error) ERR value is not an integer or out of range

127.0.0.1:6379> GET first
"this WILL be written"       ← it WAS written
```

`SET first` succeeded. Nothing was undone.

### Discard

```redis
127.0.0.1:6379> MULTI
OK
127.0.0.1:6379> SET temp 1
QUEUED
127.0.0.1:6379> DISCARD
OK
127.0.0.1:6379> GET temp
(nil)
```

---

## 4. Node.js example

### Verified output of `examples/17-transactions.mjs`

```
--- basics ---
multi replies -> [ 'OK', 1, '2' ]
  ^ the array is POSITIONAL: [SET reply, INCR reply, GET reply]

--- ⚠️ there is NO rollback ---
threw -> MultiErrorReply
  message: 2 commands failed, see .replies and .errorIndexes for more information
  replies        : [
  'OK',
  'WRONGTYPE Operation against a key holding the wrong kind of value',
  'ERR value is not an integer or out of range'
]
  errorIndexes   : [ 1, 2 ]
  ^ index 0 succeeded, 1 and 2 failed. BOTH happened. Nothing was undone.
  first  = this WILL be written
  good   = i am a string (unchanged)

--- safe transfer ---
transfer 30: { ok: true, debit: 70, credit: 30 }
alice = 70  bob = 30

⚠️ INCRBY on a MISSING key creates it at the offset value:
  replies -> [ -30, 60 ]
  ghost is now -30 ← a -30 balance was invented!

--- WATCH: optimistic locking ---
withdraw 30 -> { ok: true, reason: 'withdrew 30' }
acct is now 70

--- WATCH detects interference ---
exec threw -> WatchError: One (or more) of the watched keys has been changed
value is 999 (the other client won)

--- WATCH needs its own connection ---
dedicated connection can watch without deadlocking ✓
its own transaction works -> OK

--- ⭐ atomic conditional update (Lua) ---
first claim  -> 1
second claim -> 0 (0 = already claimed, no race possible)
  ^ only ONE of these can ever succeed, no matter how many callers

DBSIZE after cleanup: 0
```

### The reply shape

```javascript
try {
  const replies = await client.multi()
    .set('a', '10')
    .incr('counter')
    .get('b')
    .exec();
  // replies are RAW values under RESP3
  //   [ 'OK', 1, '2' ]
} catch (e) {
  // MultiErrorReply
  console.log(e.replies);       // [ 'OK', 'WRONGTYPE ...', 'ERR value is not an integer...' ]
  console.log(e.errorIndexes);  // [ 1, 2 ]
}
```

⚠️ **Don't check `replies[0].ok`.** Verified: on success the replies are raw values, so
`.ok` is `undefined` and `if (reply.ok)` is always false — a silent logic bug. My first
version of this example did exactly that.

### ⚠️ `INCRBY` on a missing key creates it

```
  replies -> [ -30, 60 ]
  ghost is now -30 ← a -30 balance was invented!
```

`INCRBY ghost -30` on a key that does not exist creates it with value **-30**. In a transfer
this means a typo in a key name silently invents a negative balance. Verify keys exist
first, or use `DECRBY` only on keys you know are present.

### `WATCH` — optimistic locking

```javascript
async function withdraw(key, amount) {
  await client.watch(key);                    // ← top-level command in v6
  const balance = Number(await client.get(key));
  if (balance < amount) {
    await client.unwatch();
    return { ok: false, reason: 'insufficient funds' };
  }
  try {
    const replies = await client.multi()
      .set(key, balance - amount)
      .exec();
    return { ok: replies[0] !== null, reason: 'withdrew ' + amount };
  } catch (e) {
    return { ok: false, reason: e.constructor.name };   // WatchError
  }
}
```

Verified — interference is detected:

```
--- WATCH detects interference ---
exec threw -> WatchError: One (or more) of the watched keys has been changed
value is 999 (the other client won)
```

⚠️ `WATCH` is **connection state**, not per-call. After a `WatchError` the client is fine,
but you should `unwatch()` on any early-return path or the watch stays armed.

### ⭐ For real conditionals, use Lua

`WATCH` + `MULTI` works but needs **retries** and is easy to get wrong. Doing the check
*inside* the server is simpler and needs no retry:

```javascript
const CLAIM = `
  local stock = tonumber(redis.call('GET', KEYS[1]) or '0')
  if stock <= 0 then return 0 end
  redis.call('DECRBY', KEYS[1], 1)
  return 1
`;
```

Verified with 50 concurrent claims on stock = 1:

```
50 concurrent claims on stock=1 -> 1 succeeded, 49 refused
```

**Exactly one** winner, with no retries and no lock. See
[Chapter 19](19-lua-scripting.md).

---

## 5. When to use it and when NOT to

### ✅ Use transactions when

- Several commands must **appear atomic** to other clients.
- You need **`DISCARD` semantics** (try something, throw it away).
- You are using **`WATCH`** for optimistic concurrency on specific keys.
- A **`MULTI/EXEC` inside a script** (rare, advanced).

### ❌ Don't use them when

| Situation | Why | Use instead |
|---|---|---|
| You want **rollback** | Doesn't exist | Lua with validation, or design idempotently |
| You want **errors to stop** the batch | They don't | Lua (`redis.pcall` + explicit checks) |
| You only want **speed** | Same as a pipeline | [Pipeline](18-pipelining.md) |
| Keys span **cluster slots** | Cross-slot `MULTI` fails | [Cluster](25-cluster.md) hash tags |
| You need **cross-key consistency at scale** | Single node only | A real database |

### Transaction vs pipeline

| | `multi().exec()` | `multi().execAsPipeline()` |
|---|---|---|
| Batched | ✅ | ✅ |
| Atomic | ✅ | ❌ |
| Interleaving | none | other commands can interleave |
| Use for | consistency | speed |

Verified:

```
multi().exec()            -> [ 'OK', null ] (atomic)
multi().execAsPipeline()  -> [ 'OK', null ] (batched, NOT atomic)
```

---

## 6. Common mistakes

**Mistake 1 — Expecting rollback.**
Verified: `SET first` succeeded while two later commands failed. Design every handler to be
**idempotent**.

**Mistake 2 — Checking `reply.ok`.**
Under RESP3 successful replies are raw values. Verified: `.ok` is `undefined`.

**Mistake 3 — Not catching `MultiErrorReply`.**
`exec()` **throws** when any command fails. An uncaught `MultiErrorReply` crashes your
request handler.

**Mistake 4 — Chaining `.watch()` off `multi()`.**
In v6, `watch` is top-level: `await client.watch(key)`. Verified: `client.multi().watch is
not a function`.

**Mistake 5 — Assuming `WATCH` protects you without retrying.**
When `EXEC` throws `WatchError` you must **read again and retry**. One attempt is not enough.

**Mistake 6 — Long-running work inside a transaction.**
Commands are queued and then run; a big batch blocks other clients for its duration.

**Mistake 7 — `INCRBY` on a missing key creating `-30`.**
Verified. Check the key exists.

**Mistake 8 — Using `MULTI` for atomicity across keys in Cluster.**
Cross-slot fails. Use hash tags `{...}` ([Chapter 25](25-cluster.md)).

**Mistake 9 — Forgetting `exec()` returns replies positionally.**
Reply `i` corresponds to command `i`. If you add a command, every index shifts.

**Mistake 10 — Thinking `MULTI` validates commands.**
Verified: `LPUSH` on a string key was accepted with `QUEUED` and only failed at `EXEC`.

---

## 7. Try it yourself

**Exercise:** Implement a seat-booking function `bookSeat(flightId, seat, userId)` that must
never double-book a seat, even if 100 clients call it simultaneously. Do it twice: once with
`WATCH` + retry, and once with a Lua script.

**Hint:** for the Lua version, pass `KEYS = [flightId]` and `ARGV = [seat, userId]`, and have
the script check-then-write with `HGET`/`HSET`. For the `WATCH` version, `watch` the flight
hash, read the seat, then `multi().hSet(...)` in a `try`, and loop on `WatchError`.

**What to notice:** both give exactly one winner, but the Lua version needs **no retry
loop** and cannot be written wrong by accident.

---

## 8. Next

**[Chapter 18 — Pipelining](18-pipelining.md)** — getting a **10×** speedup by batching
commands, without atomicity.

---

**Verified facts recap**

| Claim | How verified |
|---|---|
| `exec()` replies are **positional** | `[ 'OK', 1, '2' ]` |
| **No rollback** — `SET first` persisted | `GET first` returned the value |
| Failures **throw `MultiErrorReply`** | Caught; had `.replies` and `.errorIndexes` |
| Successful replies are raw values (`.ok` undefined) | `dres[0]` was `'OK'` |
| `INCRBY` on a missing key → `-30` | Verified |
| `WATCH` is a **top-level** command | `client.multi().watch` undefined |
| Interference throws **`WatchError`** | Caught, other client's value won |
| Lua claim: 50 concurrent → exactly **1** winner | Verified |
| `exec()` vs `execAsPipeline()` both work | Both `[ 'OK', null ]` |