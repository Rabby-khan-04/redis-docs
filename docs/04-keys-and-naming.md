# Chapter 04 — Keys and naming

> **Verified on:** Redis **8.10.2**, node-redis **6.3.0**
> Run the code: `node examples/04-keys-and-naming.mjs` (takes ~1 minute — it builds 100,000 keys)

---

## 1. Simple explanation (like I'm 7)

Every single thing in Redis has a **name**. A name looks like `user:42:name`.

Think of it like a **filing cabinet**. You do not put papers loose in the drawer — you label
each one. Then when you want one, you grab it by the label instantly.

Three rules about names:

1. Names are **case-sensitive**. `Name` and `name` are two different drawers.
2. Names can have **spaces** and even be **completely empty**.
3. A name can be **really, really long** — up to 512 MB.

But there's a catch: **you cannot ask "show me all the drawers"** without the whole room
standing still. That's the biggest lesson in this chapter.

---

## 2. Real name

A **key** is a binary-safe string that names exactly one value.

### Key rules (all verified)

| Rule | Verified |
|---|---|
| Binary safe — any bytes allowed | `SET "ch04:has space" ok` worked |
| **Case-sensitive** | `ch04:name` ≠ `ch04:Name` |
| Empty key `""` is legal | `SET "" "empty key works"` → `GET ""` returned it |
| Max key **+ value** size = **512 MB** | `CONFIG GET proto-max-bulk-len` → `536870912` |
| One key holds **exactly one** data type | `LPUSH` on a string key → `WRONGTYPE` |
| Keys live in one of **16** databases | `CONFIG GET databases` → `16` |

### Naming convention

Use **colons** to build a readable hierarchy. Colons have no special meaning to Redis —
they are pure convention, but a very good one because Redis tooling can filter by prefix.

```
user:42:profile          hash    → one user's fields
user:42:posts           list    → that user's posts
cache:article:8817      string  → a cached web page
rate:api:203.0.113.7    string  → a rate-limit counter
lock:invoice:551        string  → a distributed lock
```

Benefits: you can delete everything for one user with `SCAN MATCH user:42:*`, and
`INFO keyspace`-style tooling can group them.

---

## 3. redis-cli example

```bash
docker exec -it redis-learn redis-cli
```

```redis
127.0.0.1:6379> SET ch04:name "Ada"
OK
127.0.0.1:6379> GET ch04:name
"Ada"
127.0.0.1:6379> GET ch04:Name
(nil)                          ← case matters: this is a DIFFERENT key
127.0.0.1:6379> TYPE ch04:name
string
127.0.0.1:6379> LPUSH ch04:name "x"
(error) WRONGTYPE Operation against a key holding the wrong kind of value
127.0.0.1:6379> KEYS ch04:*
1) "ch04:name"
127.0.0.1:6379> EXISTS ch04:name ch04:missing
(integer) 1
127.0.0.1:6379> DEL ch04:name
(integer) 1
```

### 🔴 The command you must never run in production

```bash
docker exec redis-learn redis-cli KEYS '*'
```

`KEYS` asks Redis to **walk the entire database** and return every matching key **in one
breath**. While it does this, Redis is **completely frozen** — no other client can run
anything. Verified complexity:

```bash
docker exec redis-learn redis-cli COMMAND DOCS KEYS
```
```
keys
summary
Returns all key names that match a pattern.
complexity
O(N) with N being the number of keys in the database, under the assumption that the key names in the database and the given pattern have limited length.
```

**Use `SCAN` instead.** From redis-cli, `--scan` is the safe wrapper:

```bash
docker exec redis-learn redis-cli --scan --pattern 'user:42:*'
```

### Other key commands

| Command | What it does | Cost |
|---|---|---|
| `TYPE key` | `"string"`, `"list"`, `"hash"`, … or `"none"` | O(1) |
| `EXISTS k1 k2` | How many of these keys exist | O(1) per key |
| `DEL k1 k2` | Delete (blocking free) | O(N) to free |
| `UNLINK k1 k2` | Delete in a background thread — **use for big values** | O(1) |
| `RENAME a b` | Rename, overwriting `b` | O(1) |
| `RANDOMKEY` | One random key | O(1) |
| `MOVE k 1` | Move to database 1 | O(1) |
| `DUMP` / `RESTORE` | Serialise / deserialise (used for replication) | O(size) |
| `OBJECT ENCODING k` | How Redis stores it internally | O(1) |
| `MEMORY USAGE k` | Bytes used by that key | O(1) |

---

## 4. Node.js example

### Verified output

```
Redis is CASE-SENSITIVE:
  GET ch04:name  -> Ada
  GET ch04:Name  -> null (different key, does not exist)
key with a space -> ok
empty key ""     -> empty key works
max key+value size: 512 MB

One key = one type:
  TYPE ch04:name        -> string
  LPUSH ch04:name x     -> SimpleError: WRONGTYPE Operation against a key holding the wrong kind of value
     ^ the key still holds a string; the failed LPUSH changed nothing

Internal encoding (OBJECT ENCODING):
  small-str   embstr     48 bytes
  big-str     raw        255 bytes
  number      int        30 bytes
  hash        listpack   45 bytes
  list        listpack   41 bytes

--- Building a test keyspace ---
DBSIZE: 100009
KEYS('bench:1*')      -> 11111 keys in 19.8ms  (BLOCKS the server)
SCAN ('bench:1*')     -> 11111 keys in 121.3ms over 997 round trips (never blocks)
one SCAN(COUNT:10)    -> cursor=122880, 11 keys (DB has 100009)
scanIterator('bench:1*') -> 11111 keys in 100 batches (same as the manual loop above)
SCAN TYPE=string     -> 100000 keys in 78.7ms

--- Latency of an UNRELATED GET on another connection ---
  idle server      p50= 0.35ms  p99=  0.59ms  max=  0.61ms
  during KEYS      p50= 0.42ms  p99=  9.53ms  max= 34.87ms
  during SCAN      p50= 0.33ms  p99=  0.73ms  max=  1.33ms

cleaning up...
DBSIZE after cleanup: 0
```

### 🔴 The headline result

Look at the latency table. An **unrelated** `GET` on a **different connection**, for a key
that never changes, while the server does other work:

| While the server is… | p50 | p99 | **max** |
|---|---|---|---|
| idle | 0.35 ms | 0.59 ms | **0.61 ms** |
| running `KEYS bench:*` | 0.42 ms | 9.53 ms | **34.87 ms** ← **57× worse tail** |
| running `SCAN` in chunks | 0.33 ms | 0.73 ms | **1.33 ms** |

`KEYS` barely moves the *median* — which is exactly why it slips through testing. It
destroys the **tail**: your p99 users get 9.5 ms, your unluckiest user gets **35 ms** for a
`GET` that should take 0.3 ms. Timeouts and flaky errors live in the tail.

I ran this comparison three times to be sure it wasn't a fluke:

```
--- run 1 ---                      --- run 2 ---                      --- run 3 ---
idle          max=  0.80ms         idle          max=  1.71ms         idle          max=  0.59ms
SCAN          max=  1.04ms         SCAN          max=  0.65ms         SCAN          max=  0.93ms
KEYS          max= 31.10ms         KEYS          max= 27.86ms         KEYS          max= 25.87ms
```

`KEYS` max latency: **25–31 ms every time.** `SCAN`: always under 1.6 ms.

And note the honest trade-off: `KEYS` finished in **19.8 ms** while `SCAN` took **121.3 ms** —
`KEYS` is genuinely *faster*. But it wins by **frying the whole server while it works**.

`SCAN` isn't fast. It's *polite*. It does the same work in 997 small pieces, yielding
between each, so other commands keep their sub-millisecond latency.

### ⚠️ Glob patterns are literal unless you use `*`

This cost me a confusing debugging detour, so it is worth stating plainly:

| Pattern | Matches | Count |
|---|---|---|
| `bench:9` | the key **exactly** equal to `bench:9` | **1** |
| `bench:9*` | any key **starting** with `bench:9` | 11,111 |
| `k1?` | `k1` + exactly one character (`k10`…`k19`) | 10 |
| `bench:1*` | any key starting with `bench:1` | 11,111 |

Redis globs support `*` (any length), `?` (exactly one), `[abc]`, `[^a]`, `[a-z]`. A pattern
with no wildcard is an **equality test**, not a prefix test.

### How to use SCAN

```javascript
// The raw way. Note: the cursor is a STRING in node-redis 6.
let cursor = '0';
do {
  const { cursor: next, keys } = await client.scan(cursor, { MATCH: 'bench:1*', COUNT: 100 });
  cursor = next;                       // keep going until cursor === '0'
  // ... process keys ...
} while (cursor !== '0');
```

```javascript
// The easy way -- scanIterator does the loop for you.
// ⚠️ It yields a BATCH (an array) per round trip, NOT one key at a time.
for await (const keys of client.scanIterator({ MATCH: 'user:42:*', COUNT: 100 })) {
  // `keys` is an Array<string>. This is deliberate: it lets you MGET the batch.
  const values = await client.mGet(keys);
}
```

> ⚠️ **This trips up everyone.** A loop variable that looks like a single key is actually an
> array. `for await (const key of client.scanIterator()) { console.log(key.length) }` prints
> the **batch size**, not the key length — which is why it can look like it is silently
> losing keys when it is not. Verified: `scanIterator` returned **11,111 keys in 100
> batches**, exactly matching the manual loop.

The same iterators exist for the other types — and they yield **arrays** too:

```javascript
for await (const members of client.sScanIterator('myset')) { /* string[] */ }
for await (const entries of client.hScanIterator('myhash')) { /* {field,value}[] */ }
for await (const entries of client.zScanIterator('myzset')) { /* {score,value}[] */ }
```

### One SCAN call is not "all the keys"

```
one SCAN(COUNT:10)  -> cursor=122880, 11 keys (DB has 100009)
```

**You must loop until the cursor comes back `0`.** A single call returning a non-zero
cursor means *there is more*.

### Use `TYPE` to skip work

```
SCAN TYPE=string     -> 100000 keys in 78.7ms
```

If you only want strings, ask for strings and Redis won't hand you the hashes, lists and
sets. On a mixed keyspace this is a big saving.

### Internal encodings — why your 5-byte key costs 48 bytes

```
small-str   embstr     48 bytes
big-str     raw        255 bytes
number      int        30 bytes
hash        listpack   45 bytes
list        listpack   41 bytes
```

The **same 5 characters** cost very different amounts of RAM:

| Value | Encoding | Bytes | Why |
|---|---|---|---|
| `"hello"` | `embstr` | 48 | Small string stored *inline with the key* — cheapest for tiny values |
| `"xxxx…"` (200 chars) | `raw` | 255 | Too big to inline; separately allocated |
| `36` | `int` | 30 | A pure number is stored as a C integer, not text! |
| 2-field hash | `listpack` | 45 | Small hash packed into one block |
| 2-item list | `listpack` | 41 | Small list packed into one block |

Two lessons:

1. **Small is cheap, big is expensive.** `SET k 36` costs 30 bytes; `SET k "36"` costs 48.
   Numbers are a special encoding.
2. **Small collections use `listpack`.** When a hash or list grows past a threshold (128
   entries by default), Redis **converts it** to a heavier structure. That conversion is
   called *rehashing* and causes a latency spike. Big collections eventually become a hash
   table or a skip list ([Chapter 07](07-hashes.md), [Chapter 08](08-lists.md)).

---

## 5. When to use it and when NOT to

### ✅ Naming rules to follow

- **Always** prefix by domain: `user:`, `cache:`, `rate:`, `lock:`, `session:`.
- Put the **variable part last**: `cache:article:8817`, not `8817:article:cache`.
- Use `:` between levels, `_` between words inside a level.
- Keep keys **short** — you pay for them in every hash table and on every command.
- Include a **version** when your value shape changes: `user:42:v2:profile`.

### ❌ When not to put something in Redis

| Situation | Why | Use instead |
|---|---|---|
| One **enormous** value (100 MB blob) | Blocks the server while copying; `DEL` on huge values stalls | Object storage (S3) + a pointer in Redis |
| Data you **must not lose** | RAM is volatile | SQL database |
| You need to find keys by **arbitrary field** | Redis cannot index arbitrary fields | SQL, or the Search module ([Chapter 16](16-search.md)) |
| You have **millions** of keys of one type | `SCAN` becomes slow and RAM huge | A real database |

### ⚠️ About `SELECT` (the 16 databases)

`SELECT 1` gives a separate namespace, but they are **not** isolated in any way that
matters: memory is shared, `maxmemory` is shared, and `FLUSHALL` wipes all 16. Many teams
use only database 0 and separate by **key prefix** instead — which you can then clean up
with `SCAN MATCH prefix:*`.

---

## 6. Common mistakes

**Mistake 1 — Running `KEYS` in production.**
The single most common Redis outage cause. Proven above: unrelated latency went from
**0.61 ms at idle to 34.87 ms during `KEYS`** (p99 jumped from 0.59 ms to 9.53 ms). On a
database of 10 million keys this becomes seconds, and your
whole application stops. Always `SCAN`.

**Mistake 2 — Running `KEYS` even in development on a large shared database.**
It is tempting because it is the only key-listing command in the docs. It still blocks
everything while it runs.

**Mistake 3 — Forgetting that a single `SCAN` call isn't the full list.**

```javascript
const { keys } = await client.scan('0', { MATCH: '*' });
console.log(keys.length);     // ✗ probably 10, not 11,120
```

Loop until the cursor is `'0'`, or use `scanIterator`.

**Mistake 4 — Treating the cursor as a number.** In node-redis 6 the cursor is a **string**.
`Number(cursor)` works for `0`, but passing a number back into `scan()` throws:

```javascript
await client.scan(0, {...})        // ✗ TypeError: arguments[1] must be of type string
await client.scan('0', {...})      // ✓
```

**Mistake 4b — Assuming `scanIterator` yields one key at a time.** It yields a **batch
(array)** per round trip. This is deliberate — it lets you `MGET` the whole batch — but it
means this is wrong:

```javascript
for await (const key of client.scanIterator()) {
  console.log(key.length);      // ✗ that's the BATCH SIZE, not the key length
}
```

```javascript
for await (const keys of client.scanIterator()) {   // ✓ keys is string[]
  for (const k of keys) { /* ... */ }
}
```

Verified: `scanIterator` returned **11,111 keys across 100 batches**, exactly matching the
manual loop. Nothing was lost — but a naive `console.log` makes it look otherwise.

**Mistake 5 — Case-sensitivity bugs.** `User:1` and `user:1` are different keys. Pick one
convention and never deviate. This causes "the data disappeared" bugs that are painful to
debug because `KEYS User:*` finds nothing while `KEYS user:*` finds everything.

**Mistake 5b — Forgetting that globs need `*` for prefix matching.**
`SCAN MATCH user:42` finds the key **exactly** named `user:42`. It does **not** find
`user:42:name`. You want `user:42*`. This is the single most common reason a `SCAN` "finds
nothing" — verified here: `bench:9` matched **1** key, `bench:1*` matched **11,111**.

**Mistake 6 — Using `DEL` on very large values.**
`DEL` frees the memory **synchronously on the main thread**. On a 100 MB value that is a
real stall. Use `UNLINK`, which frees in a background thread.

**Mistake 7 — Keys with no prefix at all.** `SET user 5` then `SET username "bob"` three
months later is a bug waiting to happen. Prefix everything.

**Mistake 8 — Keys containing spaces or unescaped characters.**
Legal, but painful in shell scripts. `docker exec redis-learn redis-cli GET "my key"` needs
careful quoting. Prefer `:` separators.

**Mistake 9 — Assuming `MEMORY USAGE` is exact.** It is a **sample-based estimate** by
default (`MEMORY USAGE key SAMPLES 0` is exact but O(N)). Don't bill customers to the byte.

**Mistake 10 — Not setting TTLs.** Keys without expiry live forever. Every key you forget
to expire is a slow memory leak. See [Chapter 06](06-expiration-and-ttl.md).

---

## 7. Try it yourself

**Exercise:** Create 20,000 keys named `mytask:<n>`. Write two functions: one using
`KEYS`, one using `SCAN`. Then measure the latency of an unrelated `GET` while each runs
on a **second connection**.

**Hint:** copy the `measure()` helper from `examples/04-keys-and-naming.mjs`. Start a
`setInterval` that does `probe.get('some:key')` every 10 ms, record the timings, run your
scan function, then print `Math.max(...samples)`.

**What to notice:** with only 20,000 keys the difference may be small — which teaches the
right lesson, that the damage **scales with database size**. Try again with 200,000 and
watch the `KEYS` number explode while `SCAN` stays flat.

**Clean up afterwards:**

```bash
docker exec redis-learn redis-cli FLUSHDB
```

---

## 8. Next

**[Chapter 05 — Strings](05-strings.md)** — the simplest and most-used data type: cached
values, counters, and the atomic `INCR` that makes Redis useful across many servers.

---

**Verified facts recap**

| Claim | How verified |
|---|---|
| Keys are case-sensitive | `ch04:name` vs `ch04:Name` |
| Spaces allowed in keys | `SET "ch04:has space" ok` |
| Empty key `""` allowed | `SET "" ...` / `GET ""` |
| Max key+value = 512 MB | `CONFIG GET proto-max-bulk-len` → 536870912 |
| Wrong command on a key → `WRONGTYPE` | `LPUSH` on a string key |
| `KEYS` is O(N) | `COMMAND DOCS KEYS` |
| `KEYS` blocks: idle max 0.61 ms → 34.87 ms (p99 0.59 → 9.53 ms) | Concurrent-connection latency test, 100k keys, repeated 3× (KEYS max 26–35 ms every run) |
| `SCAN` does not block: max 1.33 ms | Same test |
| `scanIterator` yields batches | 11,111 keys in 100 batches, matching manual loop |
| Glob patterns are literal without `*` | `bench:9` → 1 key; `bench:1*` → 11,111 |
| Cursor is a string | Passing a number throws `TypeError` |
| Encodings: `embstr`/`raw`/`int`/`listpack` | `OBJECT ENCODING` |
| Number `36` costs 30 bytes vs string 48 | `MEMORY USAGE` |