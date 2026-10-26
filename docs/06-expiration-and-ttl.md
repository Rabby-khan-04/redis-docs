# Chapter 06 — Expiration and TTL

> **Verified on:** Redis **8.10.2**, node-redis **6.3.0**
> Run the code: `node examples/06-expiration-and-ttl.mjs`

---

## 1. Simple explanation (like I'm 7)

You wrote a note and stuck it on the fridge. But you do **not** want it there forever.

So you write on the corner: **"throw this away in 10 minutes."**

That is a TTL. After the time is up, Redis throws the note away **by itself**. You never
have to remember to delete it.

Redis even has a nice trick: it **throws away notes nobody is looking at**. If you ask for a
note that should have expired, Redis quietly acts like it was never there.

---

## 2. Real name

**TTL** = **Time To Live**. It is the number of seconds left before Redis deletes the key
automatically.

### 🔴 The most important table in this chapter

`TTL` has **three** possible answers, and confusing them is the single most common Redis
beginner bug:

| `TTL` returns | Meaning |
|---|---|
| **≥ 0** | Seconds until deletion. `0` means about to go. |
| **`-1`** | The key **exists** but has **no expiry** — it lives forever |
| **`-2`** | The key **does not exist** |

Verified:

```
key that exists, no expiry -> -1 (-1 = exists forever)
key that exists, with TTL  -> 100
key that does not exist    -> -2 (-2 = no such key)
```

⚠️ **`-2` does not mean "0 seconds left."** It means "there is no such key." If you write
`if (ttl > -2)` you will treat a missing key as "expiring soon."

### Expiry commands

| Command | What it does | Returns |
|---|---|---|
| `EXPIRE key sec` | Expire in N seconds | 1 set, 0 no key |
| `PEXPIRE key ms` | Expire in N milliseconds | 1 / 0 |
| `EXPIREAT key ts` | Expire at a Unix timestamp | 1 / 0 |
| `TTL key` | Seconds left | ≥0 / -1 / -2 |
| `PTTL key` | Milliseconds left | ≥0 / -1 / -2 |
| `EXPIRETIME key` | Absolute expiry timestamp | unix seconds |
| `PERSIST key` | Remove the expiry | 1 removed, 0 none |
| `RENAME a b` | Rename — **TTL moves with the key** | |
| `COPY src dst` | Copy — **TTL is copied too** | |

### How Redis actually deletes expired keys

Redis does **not** run a timer per key (that would be millions of timers). It uses two
mechanisms:

1. **Lazy expiration** — when you access a key, Redis checks "is this expired?" If yes, it
   deletes it and acts like it never existed. So `GET` on an expired key returns `nil`.
2. **Active expiration cycle** — a background cycle that periodically samples keys with
   TTLs and deletes the expired ones, so memory is reclaimed even if nobody ever asks for
   them.

That is why an expired key's memory isn't always freed *the instant* it expires — but it
always **behaves** expired.

### ⚠️ Expiry ≠ eviction

| | Expiry (this chapter) | Eviction ([Chapter 22](22-memory-and-eviction.md)) |
|---|---|---|
| Trigger | The key's own timer | Memory is full |
| Who decides | You, when you set the TTL | Redis, by policy |
| Applies to | Keys **you** gave a TTL to | Any key, chosen by the policy |
| Config | `SETEX`, `EXPIRE` | `maxmemory` + `maxmemory-policy` |

On this server `maxmemory-policy` is `noeviction`, so nothing is thrown away for memory
pressure yet.

---

## 3. redis-cli example

```bash
docker exec -it redis-learn redis-cli
```

```redis
127.0.0.1:6379> SET ch06:forever "v"
OK
127.0.0.1:6379> TTL ch06:forever
(integer) -1                        ← exists forever

127.0.0.1:6379> SET ch06:expiring "v" EX 100
OK
127.0.0.1:6379> TTL ch06:expiring
(integer) 100
127.0.0.1:6379> PTTL ch06:expiring
(integer) 99999                     ← milliseconds
127.0.0.1:6379> EXPIRETIME ch06:expiring
(integer) 1791451470                ← absolute unix timestamp
127.0.0.1:6379> PERSIST ch06:expiring
(integer) 1
127.0.0.1:6379> TTL ch06:expiring
(integer) -1                        ← expiry removed, lives forever now

127.0.0.1:6379> TTL ch06:ghost
(integer) -2                        ← no such key at all
```

### `EXPIRE 0` deletes immediately

```redis
127.0.0.1:6379> SET doomed "v"
OK
127.0.0.1:6379> EXPIRE doomed 0
(integer) 1
127.0.0.1:6379> EXISTS doomed
(integer) 0                         ← gone already
```

### `EXPIRE` on a missing key returns 0

```redis
127.0.0.1:6379> EXPIRE ghost 100
(integer) 0                         ← nothing to expire
```

### Watching a key actually die

```redis
127.0.0.1:6379> SET short "bye" PX 1200
OK
127.0.0.1:6379> PTTL short
(integer) 1200
127.0.0.1:6379> GET short
"bye"
# ... wait 1.5 seconds ...
127.0.0.1:6379> GET short
(nil)                              ← gone, no error
127.0.0.1:6379> TTL short
(integer) -2
```

### RENAME and COPY carry the TTL

```redis
127.0.0.1:6379> SET src "v" EX 100
OK
127.0.0.1:6379> RENAME src dst
OK
127.0.0.1:6379> TTL dst
(integer) 100                       ← the TTL travelled with the key
127.0.0.1:6379> COPY dst copy
(integer) 1
127.0.0.1:6379> TTL copy
(integer) 100                       ← and was copied too
```

This is useful and occasionally surprising: renaming a cached entry keeps its expiry, which
is usually what you want.

### Complexity

All of `EXPIRE`, `PEXPIRE`, `TTL`, `PTTL`, `EXPIRETIME`, `PERSIST` are **O(1)**.

---

## 4. Node.js example

### Verified output of `examples/06-expiration-and-ttl.mjs`

```
--- what TTL can return ---
key that exists, no expiry -> -1 (-1 = exists forever)
key that exists, with TTL  -> 100
key that does not exist    -> -2 (-2 = no such key)

⚠️  -1 and -2 mean completely different things, and -2 is NOT "0 seconds left".

--- EXPIRE / PERSIST / PEXPIRE ---
EXPIRE x 100   -> 1
TTL x          -> 100
PTTL x         -> 99999 (milliseconds)
expireTime x   -> 1791451470 (absolute unix seconds)
PERSIST x      -> 1
TTL x          -> -1 (-1 again: expiry removed)
EXPIRE ghost 100 -> 0 (0 = no key to expire)

--- EXPIRE 0 ---
EXPIRE doomed 0 -> 1
EXISTS doomed   -> 0 (gone already)

--- watching expiry happen ---
PTTL right after set -> 1200 ms
PTTL after 600ms     -> 599 ms
GET mid-life         -> bye
GET after 1.5s       -> null (expired)
TTL on expired key   -> -2 (-2)

--- lazy vs active expiration ---
created 20,000 keys with 1.5s TTL
DBSIZE now: 19990
DBSIZE after they expire: 0
   (expiry is lazy: a key is deleted when looked up, or by the active cycle)

--- RENAME / COPY and TTL ---
TTL src                -> 100
TTL after RENAME dst   -> 100 (TTL moved with the key)
COPY (ttl -1 = not copied) -> 1
TTL copy               -> 100

--- the TTL leak ---
10,000 keys with NO TTL -> memory 11781160 -> 12354008 bytes
they will stay forever. This is how Redis servers die.
DBSIZE after cleanup: 0

maxmemory-policy is: noeviction
  expiry  = this key's own timer fires  (chapters 06, 07)
  eviction = memory is full, so Redis THROWS DATA AWAY (chapter 22)
DBSIZE after final cleanup: 0
```

### Setting a TTL on write — the right way

Prefer doing it **in the same call**, so there is no window where the key has no expiry:

```javascript
await client.set('session:abc', data, { EX: 3600 });    // ✓ atomic, no gap
```

```javascript
await client.set('session:abc', data);                   // ✗ exists with no TTL
await client.expire('session:abc', 3600);                //    ...then add one
```

The second version has a race: between the two calls, another process could read the key
(uncached) or the server could crash (key lives forever). Not usually fatal, but the
one-call form is simply better.

### The renewal pattern

```javascript
// Sliding expiration: every request refreshes the window.
await client.set(`session:${sid}`, data, { EX: 3600 });
```

This is the standard session pattern: an active user stays logged in, an idle user is
logged out after an hour. (Use `KEEPTTL` instead if you want a *fixed* expiry.)

### Reading TTL safely

```javascript
const t = await client.ttl('cache:x');

if (t === -2) {
  // key does not exist -- a normal cache miss
} else if (t === -1) {
  // exists but will never expire -- probably a bug in your code
} else if (t < 10) {
  // about to expire, consider refreshing now
}
```

### The leak, measured

```
10,000 keys with NO TTL -> memory 11781160 -> 12354008 bytes
```

That's **~573 KB for 10,000 tiny keys** that can never be reclaimed. Multiply by a million
keys per day and you have an out-of-memory crash. Verified detail from earlier in this
guide: the container's `maxmemory` is **0**, i.e. unlimited — so nothing stops Redis from
eating all your RAM until the OS kills it.

### ⚠️ `DEL` with zero arguments is an error

Worth knowing because cleanup code hits it constantly:

```javascript
await client.del([]);                    // ✗ ERR wrong number of arguments for 'del'
await client.del(['a','b']);              // ✓
```

If your `SCAN` found nothing, don't call `DEL` on an empty array.

---

## 5. When to use it and when NOT to

### ✅ Always give a TTL when

| Case | TTL to use |
|---|---|
| **Cache** anything | 5 min – 1 hour. Re-fetch on miss. |
| **Sessions** | Sliding, e.g. 12–24 hours |
| **Rate limit counters** | Exactly the window length (e.g. 60s) |
| **Email / SMS codes** | 5–10 minutes |
| **Idempotency keys** | Minutes — longer defeats the purpose |
| **Locks** | As short as possible ([Ch. 29](29-real-world-patterns.md)) |
| **Leaderboards** (per-season) | Until the season ends |
| **Feature flags** | Long, but **not infinite** |

### ❌ Don't rely on TTL when

- The data **must not disappear** (users get logged out, carts vanish). Store it in a real
  database.
- You need the expiry to be **exactly** on the second — TTL is approximate.
- You are using **only volatile-key policies** for eviction, and some of your keys have no
  TTL — those keys become **un-evictable** and can trigger OOM
  ([Chapter 22](22-memory-and-eviction.md)).

### TTL vs deleting yourself

| | TTL | Manual `DEL` |
|---|---|---|
| Forgotten? | Key self-cleans ✅ | Leaks forever ❌ |
| Predictable exact time? | No | Yes |
| Cost | Almost free | A command each |
| Best for | Caches, sessions, limits | Critical cleanup |

**Use TTL as a safety net even if you also delete explicitly.**

---

## 6. Common mistakes

**Mistake 1 — Treating `-1` and `-2` the same.**
`-1` = exists forever. `-2` = doesn't exist. This one causes "why is my cache always
missing" bugs.

```javascript
const t = await client.ttl(k);
const exists = t !== -2;              // ✓
const hasTtl = t >= 0;                // ✓
```

**Mistake 2 — Losing the TTL on a plain `SET`.**
Verified in [Chapter 05](05-strings.md): TTL `100` → `-1` after a plain `SET`. Use
`{ KEEPTTL: true }`.

**Mistake 3 — Setting the TTL in a separate call, leaving a race.**

```javascript
await client.set(k, v);
await client.expire(k, 60);   // ⚠️ gap where k has NO ttl
```

Use `set(k, v, { EX: 60 })`.

**Mistake 4 — Forgetting a TTL on a rate limiter.** Then the counter never resets and that
user is permanently banned. The TTL **is** the window.

**Mistake 5 — Using a TTL on the wrong object.**
`SETEX` expires the whole key. If you want *one field* of a hash to expire, you need
`HEXPIRE` ([Chapter 07](07-hashes.md)).

**Mistake 6 — Expecting millisecond precision from `TTL`.**
`TTL` rounds **up to the next second**, which is why `EXPIRE x 100` then `PTTL x` returned
`99999`. Use `PTTL` for fine-grained work.

**Mistake 7 — Assuming expiry frees memory instantly.** It is lazy plus an active cycle.
`DBSIZE` can briefly show expired keys. `GET` always behaves correctly though.

**Mistake 8 — Very long TTLs as a "backup".** `EX 31536000` on a cache is just "no expiry"
with extra steps. If it is a cache, use a short TTL and accept re-fetches.

**Mistake 9 — `PERSIST` in production.** It makes a temporary key permanent. Rarely what
you want.

**Mistake 10 — Assuming `EXPIRE` on a missing key creates it.** It returns `0` and creates
nothing.

---

## 7. Try it yourself

**Exercise:** Write a function `setWithTtl(key, value, ttlSeconds)` that sets a value and
guarantees a TTL — including on the second call, when the key already exists. Then prove it
by writing the same key three times and checking `TTL` each time.

**Hint:** the bug you are guarding against is a plain `set()` that wipes the TTL. Either
pass `{ EX }` on every call, or check `ttl()` first and use `persist()` + `expire()`.
Watch what happens to the TTL in each variant.

**Stretch:** create 50,000 keys with a 3-second TTL, then poll `DBSIZE` every 500 ms and
watch it drain. That is the active expiration cycle doing its job.

---

## 8. Next

**[Chapter 07 — Hashes](07-hashes.md)** — storing a record as separate fields so you can
read or change **one** value without rewriting the whole object.

---

**Verified facts recap**

| Claim | How verified |
|---|---|
| `TTL` → `-1` (no expiry), `-2` (no key), ≥0 (seconds) | Three live keys |
| `PERSIST` returns TTL to `-1` | Before/after |
| `EXPIRE 0` deletes immediately | `EXISTS` → 0 |
| `EXPIRE` on missing key returns 0 | Direct |
| Expired key: `GET` → `null`, `TTL` → `-2` | After 1.5 s wait |
| `PTTL` gives ms and rounds `TTL` up (`99999`) | Direct |
| `EXPIRETIME` returns absolute unix ts | Direct |
| `RENAME` carries the TTL | `100` → `100` |
| `COPY` carries the TTL | `100` → `100` |
| 20k keys with TTL all expired → `DBSIZE 0` | Active cycle |
| 10k keys with no TTL leak ~573 KB permanently | `INFO memory` 11781160 → 12354008 |
| `DEL []` is an error | `ERR wrong number of arguments` |
| `maxmemory-policy` is `noeviction` | `CONFIG GET maxmemory-policy` |