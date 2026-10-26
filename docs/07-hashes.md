# Chapter 07 — Hashes

> **Verified on:** Redis **8.10.2**, node-redis **6.3.0**
> Run the code: `node examples/07-hashes.mjs`

---

## 1. Simple explanation (like I'm 7)

A string is one big note. If you want to change **one word**, you have to write the whole
note again.

A **hash** is a note **with lines on it**:

```
name: Ada
age: 36
city: London
```

Now you can change just the `city` line without touching `name` or `age`.

And here is the really clever bit: Redis can **give each line its own expiry date**. So
`flash: Welcome!` can disappear after 2 seconds while `token: abc` stays all day. A plain
string can never do that.

---

## 2. Real name

A **hash** is a **map of field → value** stored under one key. Also called a *dictionary*.

```redis
HSET user:1 name "Ada" age "36" city "London"
```

Each of `name`, `age`, `city` is a **field**. Each value is a **string** (Redis has no
separate number type — everything is a string).

### Core commands

| Command | Cost | What it does |
|---|---|---|
| `HSET key field value` | O(1) | Set one field |
| `HGET key field` | O(1) | Read one field |
| `HGETALL key` | **O(N)** | Read every field — ⚠️ don't on big hashes |
| `HDEL key field` | O(1) | Remove a field |
| `HEXISTS key field` | O(1) | Does the field exist? |
| `HLEN key` | O(1) | How many fields |
| `HKEYS` / `HVALS` | **O(N)** | All field names / values |
| `HINCRBY key field n` | O(1) | Atomic increment on a field |
| `HINCRBYFLOAT key field x` | O(1) | Atomic float increment |
| `HRANDFIELD key [count]` | O(N)/O(1) | Random field(s) |
| `HSCAN key cursor` | O(1) per call | **Safe** iteration |

### Field-level TTL (Redis 7.4+) — the headline feature

| Command | What it does |
|---|---|
| `HEXPIRE key sec FIELDS n field...` | Expire specific fields |
| `HPEXPIRE`, `HEXPIREAT` | Millisecond / absolute variants |
| `HTTL key FIELDS n field...` | Seconds left on those fields |
| `HPERSIST key FIELDS n field...` | Remove field TTLs |
| `HEXPIRETIME` | Absolute expiry per field |

`HEXPIRE` returns **one code per field**:

| Code | Meaning |
|---|---|
| `-2` | Field does not exist |
| `0` | Condition (`NX`/`XX`/`GT`/`LT`) not met |
| `1` | Expiry set or updated |
| `2` | Field **deleted** because the time was already in the past |

### Internal encodings — and the 513-field cliff

A small hash is stored as a **listpack**: one compact contiguous block, very cheap.
When it grows past a threshold, Redis **rebuilds** it as a real **hashtable**.

Verified on this server:

```
hash-max-listpack-entries : 512
hash-max-listpack-value   : 64
```

```
2 fields   -> listpack (46 bytes)
600 fields  -> hashtable (26055 bytes)
converted to hashtable at 513 fields
```

That conversion is a **full rebuild** — a one-off latency spike when your hash crosses 513
fields. This is why "just put it all in one hash" is a real design decision, not a free
choice.

---

## 3. redis-cli example

```bash
docker exec -it redis-learn redis-cli
```

```redis
127.0.0.1:6379> HSET ch07:user:1 name "Ada" age "36" city "London"
(integer) 3
127.0.0.1:6379> HGET ch07:user:1 name
"Ada"
127.0.0.1:6379> HLEN ch07:user:1
(integer) 3
127.0.0.1:6379> HEXISTS ch07:user:1 nope
(integer) 0
127.0.0.1:6379> HKEYS ch07:user:1
1) "name"
2) "age"
3) "city"
127.0.0.1:6379> HVALS ch07:user:1
1) "Ada"
2) "36"
3) "London"
127.0.0.1:6379> HGETALL ch07:user:1
1) "name"
2) "Ada"
3) "age"
4) "36"
5) "city"
6) "London"

127.0.0.1:6379> HSET ch07:user:1 city "Paris"     ← only this field changes
OK
127.0.0.1:6379> HGET ch07:user:1 name
"Ada"                                             ← untouched
127.0.0.1:6379> HINCRBY ch07:user:1 age 1
(integer) 37
127.0.0.1:6379> HDEL ch07:user:1 city
(integer) 1
```

Missing things are **not errors**:

```redis
127.0.0.1:6379> HGET ch07:user:1 nope
(nil)
127.0.0.1:6379> HGETALL ch07:ghost
(empty array or object)
```

### 🔴 Field-level TTL

```redis
127.0.0.1:6379> HSET session token "abc" csrf "xyz" flash "Welcome!"
(integer) 3

127.0.0.1:6379> HTTL session FIELDS 1 flash
(integer) -1                          ← exists, no field TTL

127.0.0.1:6379> HEXPIRE session 2 FIELDS 1 flash
(integer) 1                           ← expiry set

127.0.0.1:6379> HTTL session FIELDS 1 flash
(integer) 2

127.0.0.1:6379> HGETALL session
1) "token"
2) "abc"
3) "csrf"
4) "xyz"
5) "flash"
6) "Welcome!"

# ... wait 2.3 seconds ...

127.0.0.1:6379> HGETALL session
1) "token"
2) "abc"
3) "csrf"
4) "xyz"                             ← ONLY flash is gone
```

> ⚠️ **The `FIELDS numfields` prefix is required in redis-cli.** `HTTL session flash` is an
> `ERR wrong number of arguments`. In node-redis you pass an **array** and the client adds
> the prefix for you.

### ⚠️ `HGETALL` is O(N)

```bash
docker exec redis-learn redis-cli COMMAND DOCS HGETALL
```
```
hgetall
summary
Returns all fields and values in a hash.
complexity
O(N) where N is the size of the hash.
```

Never `HGETALL` a hash with 100,000 fields in a request path. Use `HSCAN`
([Chapter 04](04-keys-and-naming.md)) or fetch just the fields you need.

---

## 4. Node.js example

### Verified output of `examples/07-hashes.mjs`

```
--- basics ---
HGET name        -> Ada
HLEN             -> 3
HEXISTS name     -> 1
HEXISTS nope     -> 0
HKEYS            -> [ 'name', 'age', 'city' ]
HVALS            -> [ 'Ada', '36', 'London' ]
HGETALL          -> { name: 'Ada', age: '36', city: 'London' }
missing field    -> null (null, not an error)
missing key      -> {} (empty object, not an error)

--- partial update ---
after city=Paris -> Paris
name untouched    -> Ada
HINCRBY age 1    -> 37
HDEL city        -> 1
HLEN after HDEL  -> 2

--- string+JSON vs hash ---
string version -> {"name":"Ada","age":37,"city":"London"}
hash version   -> { name: 'Ada', age: '37', city: 'London' }
read ONE field -> Ada (no parsing needed)

--- encoding cliff ---
hash-max-listpack-entries : 512
hash-max-listpack-value   : 64
2 fields   -> listpack (46 bytes)
600 fields  -> hashtable (26055 bytes)
converted to hashtable at 513 fields
  ^ the conversion is a full rebuild -- a one-off latency spike at 513 fields

--- field-level TTL ---
HGET flash (no field TTL) -> Welcome!
HTTL before               -> [ -1 ]
HEXPIRE flash 2s          -> [ 1 ]
HTTL after                -> [ 2 ]
HTTL several fields       -> [ 2, -1 ]
HGETALL (flash still here)-> { flash: 'Welcome!', token: 'abc', csrf: 'xyz' }
HGETALL after 2.3s        -> { token: 'abc', csrf: 'xyz' }
  ^ only the expired FIELD vanished; token and csrf are untouched
HTTL on now-missing field -> [ -2 ] (-2)
key-level TTL             -> 100

--- HSCAN ---
HGETALL returns 600 fields at once (O(N))
hScanIterator walked 600 fields in 6 batches without blocking
  (batches match the manual HSCAN round-trips; nothing is lost)
manual HSCAN loop     -> 600 fields in 6 rounds (identical)

--- HSCAN options ---
hScanIterator MATCH 'f1?' -> 10 fields in 12 batches (server-side filter)

DBSIZE after cleanup: 0
```

### `hSet` takes an object — very handy

```javascript
await client.hSet('user:1', { name: 'Ada', age: '36', city: 'London' });
await client.hGetAll('user:1');   // { name: 'Ada', age: '36', city: 'London' }
```

It returns the number of fields **newly created** (not the total). `hSet` on an existing
field returns `0`.

Note that `age` comes back as the **string** `'36'`. Use `hIncrBy` to change numbers — it
keeps them parseable.

### The whole point: partial update

```javascript
await client.hSet('user:1', 'city', 'Paris');   // one field, one command
```

No read, no parse, no re-serialise, no risk of clobbering a concurrent write to another
field.

### String+JSON vs hash — measured

```
string version -> {"name":"Ada","age":37,"city":"London"}
hash version   -> { name: 'Ada', age: '37', city: 'London' }
read ONE field -> Ada (no parsing needed)
```

To bump `age` in the string version you must `GET`, `JSON.parse`, add 1,
`JSON.stringify`, `SET` — four operations and a race window. The hash version is one
command. If two requests bump `age` simultaneously, the string version can **lose an
increment**; `hIncrBy` cannot.

### ⚠️ `hTTL` / `hExpire` signature — the `FIELDS` trap

```javascript
// ✓ CORRECT — pass an array; the client inserts "FIELDS 1" for you
await client.hExpire('session', ['flash'], 2);       // → 1  (1 = expiry set)
await client.hTTL('session', ['flash']);              // → [2]
await client.hTTL('session', ['flash', 'token']);    // → [2, -1]  (one per field)

// ✗ WRONG — do not pass the FIELDS keyword yourself
await client.hTTL('session', 'FIELDS', '1', 'flash'); // → [ -2 ]  silently wrong
```

Verified: the wrong form returns `[-2]` instead of the real TTL. It does **not** throw, so
this bug is silent.

### ⚠️ `hScanIterator` yields batches

Same trap as `scanIterator` in [Chapter 04](04-keys-and-naming.md):

```javascript
// ✓ batch is an ARRAY of { field, value }
for await (const batch of client.hScanIterator('big', { COUNT: 100 })) {
  for (const { field, value } of batch) { /* ... */ }
}
```

Verified proof that nothing is lost — the iterator and a manual loop agree exactly:

```
hScanIterator walked 600 fields in 6 batches without blocking
manual HSCAN loop     -> 600 fields in 6 rounds (identical)
```

If you want the manual loop, note the argument order — `hScan` takes the **key first**:

```javascript
let cursor = '0';
do {
  const { cursor: next, entries } = await client.hScan('big', cursor, { COUNT: 100 });
  cursor = next;                     // note: hScan(key, cursor, opts)
} while (cursor !== '0');
```

> ⚠️ `hScan(key, cursor, opts)` — unlike `scan(cursor, opts)`, which has **no key** because
> `SCAN` walks the whole database. Getting this backwards throws
> `"arguments[2]" must be of type string`.

### The 513-field cliff, demonstrated

```javascript
for (let i = 0; i < 600; i++) {
  await client.hSet('big', 'f' + i, 'v' + i);
  // encoding flips here, at field 513
}
```

```
2 fields   -> listpack (46 bytes)
600 fields  -> hashtable (26055 bytes)
converted to hashtable at 513 fields
```

Two practical consequences:

1. **Memory jumps when you cross the threshold** — a 2-field hash costs 46 bytes; a
   600-field one costs 26,055. That is per-key overhead plus per-field overhead.
2. **The 513th `HSET` is slow.** Redis rebuilds the whole structure. If your request path
   adds fields one at a time and you happen to be near 512, you get a latency spike. Batch
   your writes, or shard the hash before it gets that big.

---

## 5. When to use it and when NOT to

### ✅ Use a hash when

- You store a **record with named fields** (a user, a product, a cart line).
- You mostly **read or write one field at a time**.
- You need **per-field expiry** — sessions with a short-lived `flash` message, verification
  codes, feature flags with their own rollout dates.
- You want to **increment a field** without reading the record.
- Fields are **small and bounded** (well under a few hundred).

### ❌ Don't use a hash when

| Situation | Why | Use instead |
|---|---|---|
| You need **field-level queries** ("all users aged 30+") | Redis can't index hash fields | [Search](16-search.md) or SQL |
| The hash has **thousands of fields** | `HGETALL` is O(N); the 513 cliff adds latency | Split into several keys |
| Values are **nested** objects or arrays | Hashes are flat | [JSON](15-json.md) |
| You need to **query by value range** | Not supported | [Sorted set](10-sorted-sets.md) |
| Two records need **field-level locks** | Too fine-grained | Revisit the model |
| You need **exact relational constraints** | No constraints exist | SQL |

### Hash vs string vs JSON

| | Hash | String+JSON | JSON |
|---|---|---|---|
| Read one field | ✅ O(1) | ❌ read+parse whole | ✅ JSONPath |
| Update one field | ✅ one command | ❌ read+write whole | ✅ in place |
| Per-field TTL | ✅ (7.4+) | ❌ | ❌ |
| Nested data | ❌ | ✅ | ✅ |
| Indexable/searchable | via Search | ❌ | ✅ via Search |
| Overhead per field | low | low | higher |

Default: **Hash** for flat records, **JSON** for nested documents.

---

## 6. Common mistakes

**Mistake 1 — Using `HGETALL` on a large hash in a request path.**
`O(N)` and one big reply. Use `HSCAN`, or fetch specific fields with `HMGET`.

**Mistake 2 — Passing `FIELDS` manually to `hTTL`/`hExpire`.**
Returns `[-2]` silently. Pass an **array**: `hTTL(key, ['flash'])`.

**Mistake 3 — Expecting numbers back from `HGETALL`.**
`age` is the string `'36'`. Use `hIncrBy` to modify, `Number()` to parse.

**Mistake 4 — Assuming `hScanIterator` yields one field at a time.**
It yields **arrays**. Verified 600 fields in 6 batches — matching the manual loop exactly.

**Mistake 5 — Calling `hScan(cursor, opts)` without the key.**
The signature is `hScan(key, cursor, opts)`. `scan` has no key; `hScan` does.

**Mistake 6 — One giant hash instead of many small ones.**
Past 513 fields you pay the rebuild spike and `HGETALL` gets slow. Shard early:
`user:1:profile`, `user:1:settings`.

**Mistake 7 — Treating a hash as a place to store big blobs.**
`hash-max-listpack-value` is **64 bytes**. A field larger than that forces the whole hash
out of listpack encoding immediately — so one 10 KB field makes *all* your small fields pay
the heavier encoding. Keep values small.

**Mistake 8 — Deleting a field you meant to clear.**
`HDEL key field` **removes** the field. To blank it, `HSET key field ""`.

**Mistake 9 — Confusing field TTL with key TTL.**
They are independent. `EXPIRE session 100` expires the **whole hash**;
`HEXPIRE session 5 FIELDS 1 flash` expires **one field**. Verified both work side by side.

**Mistake 10 — Forgetting `HEXPIRE` returns one code per field.**
A `0` means the condition wasn't met; a `2` means the field was **deleted** because the
expiry was in the past. Always inspect the array, don't assume success.

---

## 7. Try it yourself

**Exercise:** Build a hash with exactly **520** fields, printing `OBJECT ENCODING` after
every 100 fields. Then use `HEXPIRE` to give three different fields three different TTLs
(2s, 5s, 30s) and poll `HGETALL` to watch them disappear one by one while the rest stay.

**Hint:** `await client.hSet('h', 'f' + i, 'v' + i)` in a loop, and
`await client.objectEncoding('h')` to watch it flip.

For three different TTLs, call `hExpire` **three times** — the signature is
`hExpire(key, fields, seconds)`, so **one `seconds` value is shared by every field in the
call**. Passing an array of TTLs fails:

```javascript
await client.hExpire('h', ['a','b','c'], [2,5,30]);
// ERR value is not an integer or out of range   ← verified

await client.hExpire('h', ['a'], 2);
await client.hExpire('h', ['b'], 5);
await client.hExpire('h', ['c'], 30);      // ✓
```

(You *can* expire several fields to the same TTL in one call, since the seconds are shared:
`hExpire('h', ['a','b'], 5)`.)

**What to notice:** the encoding flip happens at 513, not 512 — the threshold config is
`hash-max-listpack-entries: 512`, and conversion triggers on the value that **exceeds** it.
And a field-level TTL expiring leaves the rest of the hash completely untouched, which is
the whole reason to prefer hashes over JSON for session-like data.

---

## 8. Next

**[Chapter 08 — Lists](08-lists.md)** — ordered collections, queues, and the array-vs-varlist
encoding switch.

---

**Verified facts recap**

| Claim | How verified |
|---|---|
| `HGETALL` → `{ field: value }` object | Direct |
| Missing field → `null`, missing key → `{}` | Direct |
| `HINCRBY` works on a field | `age` 36 → 37 |
| `hExpire(key, ['flash'], 2)` → `[1]`, `hTTL` → `[2]` | Direct |
| Passing `FIELDS` manually → wrong `[-2]` | Direct |
| Field TTL removes only that field | `HGETALL` after 2.3 s |
| Expired field → `-2` from `hTTL` | Direct |
| Key TTL and field TTL coexist | `EXPIRE` → 100 while fields had TTLs |
| `hash-max-listpack-entries` = **512** | `CONFIG GET` |
| Encoding flips at **513** fields | Walked 600 fields, checked each |
| 2 fields = 46 bytes; 600 fields = 26,055 bytes | `MEMORY USAGE` |
| `hScanIterator` yields batches (6 for 600 fields) | Matches manual `hScan` loop |
| `hScan(key, cursor, opts)` arg order | Wrong order throws `TypeError` |
| `hScanIterator` with `MATCH 'f1?'` → 10 | Glob semantics |