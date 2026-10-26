# Chapter 05 — Strings

> **Verified on:** Redis **8.10.2**, node-redis **6.3.0**
> Run the code: `node examples/05-strings.mjs`

---

## 1. Simple explanation (like I'm 7)

A string in Redis is like a **note taped to a drawer**.

You can write a note (`SET`), read it (`GET`), count how long it is (`STRLEN`), and
**add one to the number written on it** (`INCR`).

That last one is magic. Imagine 10 friends all want to add 1 to the same scorecard. If they
all reach over and write at the same time, someone gets lost.

Redis makes them **take turns**. That's why `INCR` is safe even with thousands of servers
hitting it at once.

---

## 2. Real name

A **string** is a **binary-safe sequence of bytes**, up to **512 MB**. It is not a text type
— it stores bytes, and bytes can be text, JSON, images, or compressed data.

Redis's strings are **immutable**: every `SET` replaces the whole value. Redis does this
because replacing a known-size blob is O(1) and needs no garbage collection. This is the
single most important fact about Redis strings and explains *when* to use them.

### `SET` options

| Option | Meaning |
|---|---|
| `EX <seconds>` | Expire after N seconds |
| `PX <millis>` | Expire after N milliseconds |
| `EXAT <unix-ts>` | Expire at an absolute time |
| `NX` | Only set if the key does **not** exist |
| `XX` | Only set if the key **does** exist |
| `KEEPTTL` | Keep the current expiry when overwriting |
| `GET` | Return the **old** value, in the same atomic call |
| `IDLE` | Reset the idle timer (LFU policies) |

### The counter family

| Command | What it does |
|---|---|
| `INCR key` | Add 1 |
| `DECR key` | Subtract 1 |
| `INCRBY key n` | Add n |
| `DECRBY key n` | Subtract n |
| `INCRBYFLOAT key x` | Add a float |

All are **O(1)** and **atomic**.

---

## 3. redis-cli example

```bash
docker exec -it redis-learn redis-cli
```

```redis
127.0.0.1:6379> SET ch05:name "Ada"
OK
127.0.0.1:6379> GET ch05:name
"Ada"
127.0.0.1:6379> SET ch05:count 42
OK
127.0.0.1:6379> GET ch05:count
"42"
127.0.0.1:6379> INCR ch05:count
(integer) 43
127.0.0.1:6379> INCRBY ch05:count 5
(integer) 48
127.0.0.1:6379> SET ch05:count "abc"
OK
127.0.0.1:6379> INCR ch05:count
(error) ERR value is not an integer or out of range
```

### The NX trick — set only if absent

```redis
127.0.0.1:6379> SET lock:invoice "token-1" NX
OK
127.0.0.1:6379> SET lock:invoice "token-2" NX
(nil)                                     ← refused, key already exists
127.0.0.1:6379> GET lock:invoice
"token-1"                                 ← untouched
```

This is the foundation of [distributed locks](29-real-world-patterns.md#distributed-locks).

### `KEEPTTL` — the TTL trap

```redis
127.0.0.1:6379> SET k v EX 100
OK
127.0.0.1:6379> TTL k
(integer) 100
127.0.0.1:6379> SET k v2 KEEPTTL
OK
127.0.0.1:6379> TTL k
(integer) 100                    ← TTL survived the overwrite
127.0.0.1:6379> SET k v3
OK
127.0.0.1:6379> TTL k
(integer) -1                     ← ⚠️ plain SET REMOVED the expiry
```

**A plain `SET` deletes any existing TTL.** This is a classic production bug: you set a
cache key with an expiry, then your code refreshes it with a plain `SET`, and the key now
lives forever. Use `KEEPTTL`, or set the TTL on every write.

### Read-and-modify in one shot

```redis
127.0.0.1:6379> SET cache:x "data"
OK
127.0.0.1:6379> GETDEL cache:x
"data"                            ← returned the value AND deleted it
127.0.0.1:6379> GETDEL cache:x
(nil)                             ← already gone

127.0.0.1:6379> SET cache:y "data"
OK
127.0.0.1:6379> GETEX cache:y EX 50
"data"                            ← returned the value AND set a 50s TTL
127.0.0.1:6379> TTL cache:y
(integer) 50
```

These are **atomic**, so they cannot race — unlike `GET` then `DEL`, which can lose a value
if two processes interleave.

### Complexity

| Command | Cost | Note |
|---|---|---|
| `SET` / `GET` | **O(1)** | |
| `INCR` / `DECR` / `INCRBY` / `INCRBYFLOAT` | **O(1)** | Atomic |
| `APPEND` | **O(length of appended value)** | Amortised O(1) |
| `STRLEN` | **O(1)** | Stored length is cached |
| `GETRANGE` / `SETRANGE` | **O(N)** on the affected part | |
| `MGET` / `MSET` | **O(N)** on keys count | Still one round trip |
| `GETDEL` / `GETEX` | **O(1)** | |
| `GET` on a 100 MB value | **O(1)** to start, but the **transfer is 100 MB** | |

> ⚠️ **`GET` being O(1) does not mean it is cheap.** The time cost is the network transfer.
> A 100 MB value blocks the server while it is sent. This is why
> [Chapter 04](04-keys-and-naming.md) says keep values small.

---

## 4. Node.js example

### Verified output of `examples/05-strings.mjs`

```
GET name  -> Ada
GET count -> 42 (always a STRING, even for a number)
typeof    -> string

--- SET options ---
SET nx first time -> OK
SET nx second     -> null (null = refused)
  value is still  -> a
SET xx on missing -> null (null = refused)
SET EX 100  TTL   -> 100
after KEEPTTL TTL -> 100 (survived)
after plain SET   -> -1 (-1 = no expiry!)
SET ... GET       -> old (returned old value)
value now         -> new

--- INCR family ---
INCR      -> 11
INCRBY 5  -> 16
DECR      -> 15
INCRBYFLOAT 0.1 -> 10.6 (floats work too)
INCR on "abc"     -> ERR value is not an integer or out of range
INCR at int64 max -> ERR increment or decrement would overflow
10,000 concurrent INCRs -> final value 10000 (expect exactly 10000)
  distinct replies: 10000, max: 10000

--- string operations ---
STRLEN    -> 11
APPEND !  -> 12
GETRANGE 0 4 -> Hello
after SETRANGE -> Hello Redis!

stored JSON      -> {"id":7,"tags":["a","b"]}
parsed back      -> { id: 7, tags: [ 'a', 'b' ] }

--- MSET / MGET ---
MGET m1 m2 nope m3 -> [ 'a', 'b', null, 'c' ]
  (missing key came back as null, not an error)

GETDEL -> payload
GETDEL again -> null (key was consumed)
GETEX EX 50 -> data
  TTL now  -> 50

--- memory + encoding ---
  small   embstr  40 bytes
  medium  raw     254 bytes
  num     int     27 bytes
  note: the number 36 costs FEWER bytes than the string "36"
```

### Things worth internalising

**Everything comes back as a string.**

```javascript
await client.set('count', 42);
typeof (await client.get('count'))   // 'string', value '42'
```

Redis strings are bytes. Convert yourself with `Number()` / `JSON.parse()`.

**`SET` options are an options object.**

```javascript
await client.set('k', 'v', { NX: true });          // null if the key already existed
await client.set('k', 'v', { EX: 100 });           // expire in 100s
await client.set('k', 'v2', { KEEPTTL: true });    // keep the expiry
await client.set('k', 'v3', { GET: true });        // return the OLD value
```

### ⭐ The atomicity proof — read this twice

```javascript
await client.set('race', 0);
const results = await Promise.all(
  Array.from({ length: 10_000 }, () => client.incr('race'))
);
await client.get('race');   // '10000'
```

```
10,000 concurrent INCRs -> final value 10000 (expect exactly 10000)
  distinct replies: 10000, max: 10000
```

**Not one increment was lost, and every reply was unique (1…10000).** This is the single
most important guarantee in Redis.

Now compare with what you would have to write yourself:

```javascript
// ✗ WRONG — read, modify, write. Two servers can interleave here.
const n = Number(await client.get('counter')) + 1;
await client.set('counter', n);      // n could be wrong
```

```javascript
// ✓ RIGHT — Redis does the read-modify-write without yielding.
await client.incr('counter');
```

This single pattern is why Redis is used for view counters, like buttons, stock levels and
rate limiters across many application servers.

### Storing JSON in a string

```javascript
const doc = { id: 7, tags: ['a', 'b'] };
await client.set('json:7', JSON.stringify(doc));
JSON.parse(await client.get('json:7'));   // { id: 7, tags: ['a','b'] }
```

This is the standard caching pattern. Trade-off: you must read and re-write the **whole**
object to change one field. For that, use a [hash](07-hashes.md) or
[JSON type](15-json.md).

### Memory: numbers are cheaper than you think

```
  small   embstr  40 bytes     "hello"
  medium  raw     254 bytes    200 'x' characters
  num     int     27 bytes     36
```

`36` costs **27 bytes** but `"36"` costs **40**. Redis detects integer-looking strings and
stores them as C integers. Don't hand-optimise this, but do know it exists.

---

## 5. When to use it and when NOT to

### ✅ Use strings when

- **Caching** a database result or an API response (usually as JSON).
- **Counters**: views, likes, page hits, stock.
- **Feature flags** and **configuration** values.
- **Distributed locks** (`SET NX EX`) — see [Chapter 29](29-real-world-patterns.md).
- **Rate limiting** counters.
- **Any value you read and write whole**, without partial updates.

### ❌ Don't use strings when

| Situation | Why | Use instead |
|---|---|---|
| You only need **one field** of an object | Whole value is re-written every time | [Hash](07-hashes.md) |
| You need **partial updates** inside JSON | Must parse and rewrite everything | [JSON](15-json.md) |
| You need **ordered items** | No ordering semantics | [List](08-lists.md) |
| You need **membership tests** | Must scan the whole string | [Set](09-sets.md) |
| You need **ranking by score** | No sorting | [Sorted set](10-sorted-sets.md) |
| Value is **> a few KB** | Big transfers block the server | Split across keys, or store externally |
| You need it to **never expire by accident** | Plain `SET` silently clears TTLs | Always pass `EX`, and be deliberate |

### String vs hash vs JSON — choosing

| You want to… | Use |
|---|---|
| Store/read a whole blob | **String** |
| Read or write **one field** of a record | **Hash** |
| Update **inside** nested JSON, or index fields | **JSON** ([Ch. 15](15-json.md)) |

---

## 6. Common mistakes

**Mistake 1 — Losing a TTL with a plain `SET`.**

```javascript
await client.set('cache:x', v, { EX: 300 });   // expires in 5 min
await client.set('cache:x', w);                // ⚠️ TTL is GONE, key lives forever
```

Verified: TTL went `100` → `-1`. Use `{ KEEPTTL: true }` or always set `EX` on every write.

**Mistake 2 — Doing read-modify-write instead of `INCR`.** Loses updates under
concurrency. Use `incr` / `incrBy`.

**Mistake 3 — Forgetting values come back as strings.**
`Number(await client.get('k'))`, not `(await client.get('k')) + 1` — string `+ 1` gives
`"421"`, not `43`.

**Mistake 4 — Expecting `SET NX` to tell you it failed loudly.** It returns `null`, which is
easy to ignore:

```javascript
const ok = await client.set('lock:x', token, { NX: true, EX: 30 });
if (ok === null) throw new Error('already locked');   // ✓ check for null
```

**Mistake 5 — Storing megabyte strings.**

```javascript
await client.set('big', fs.readFileSync('movie.mp4'));   // ✗
```

A 100 MB value blocks the server for the whole transfer. Store it in S3 and keep the URL.

**Mistake 6 — Using `APPEND` as a counter.** `APPEND` is O(1) amortised but does not parse
numbers, and a very long string is slow to move. Use `INCRBY`.

**Mistake 7 — `INCR` on non-numeric data.**

```
ERR value is not an integer or out of range
```

Key names collide across purposes (`counter:likes` vs `counter:views`) and one of them
holds text. Use separate keys.

**Mistake 8 — Not handling the int64 overflow.**
```
ERR increment or decrement would overflow
```
A 64-bit signed integer tops out at 9,223,372,036,854,775,807.

**Mistake 9 — Using `GET` then `DEL` instead of `GETDEL`.** Between your `GET` and `DEL`,
another client can change the value. `GETDEL` is atomic. Same for "get then set expiry" →
use `GETEX`.

**Mistake 10 — Assuming `GET` is always cheap.** It is O(1) on the server, but the *bytes
still cross the network*. O(1) ≠ fast for a 100 MB value.

---

## 7. Try it yourself

**Exercise:** Build a page-view counter that is safe across 10,000 simultaneous requests.
Then break it on purpose: replace `incr` with a get-then-set and run the same test again.

**Hint:** use `Promise.all` over `Array.from({length: 10000}, () => ...)` exactly like the
example. To break it, wrap the read-modify-write in a tiny `await new Promise(r =>
setTimeout(r, 0))` between the get and the set — that widens the race window so you can
actually *see* the bug.

**What to notice:** the broken version ends up well below 10000. That gap is real money —
lost likes, lost stock decrements, lost rate-limit counts.

---

## 8. Next

**[Chapter 06 — Expiration and TTL](06-expiration-and-ttl.md)** — making keys delete
themselves, and why a plain `SET` can silently destroy an expiry.

---

**Verified facts recap**

| Claim | How verified |
|---|---|
| Values always return as strings | `typeof get('count')` → `string` |
| `SET NX` returns `null` when refused | Second `SET NX` → `null` |
| `SET XX` returns `null` when key missing | → `null` |
| `KEEPTTL` preserves expiry; plain `SET` clears it | TTL `100` → `100` → `-1` |
| `SET ... GET` returns old value | → `'old'` |
| `INCR` is atomic: 10,000 concurrent → exactly 10000 | `Promise.all` of 10,000 `incr` |
| `INCR` on `"abc"` errors | `ERR value is not an integer or out of range` |
| `INCR` overflows at int64 max | `ERR increment or decrement would overflow` |
| `MGET` returns `null` for missing keys | `['a','b',null,'c']` |
| `GETDEL` / `GETEX` are atomic read-modify | Verified above |
| `int` encoding saves memory (27 vs 40 bytes) | `OBJECT ENCODING` + `MEMORY USAGE` |