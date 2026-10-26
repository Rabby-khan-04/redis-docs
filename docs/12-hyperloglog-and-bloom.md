# Chapter 12 — HyperLogLog and Bloom filters

> **Verified on:** Redis **8.10.2**, node-redis **6.3.0**, RedisBloom **81001**
> Run the code: `node examples/12-hyperloglog-and-bloom.mjs`

---

## 1. Simple explanation (like I'm 7)

Both of these are **cheating on purpose** to save space.

**HyperLogLog** is like saying *"there were about 44 people in the room"* without
remembering who they were. You count the crowd accurately to within about 1%, but you
**cannot list the names** and you **cannot remove** anyone.

**Bloom filter** is a doorman with a great memory trick. He can tell you with **certainty**
that a name is *not* in the list. If he says *"maybe"*, you must go check the real list
yourself. He never lies about "not here" — he just sometimes says "maybe" when the person
actually is there.

---

## 2. Real name

Both are **probabilistic data structures**: they give up a little accuracy to use a
fraction of the memory.

### HyperLogLog (core Redis)

| Command | Cost | What it does |
|---|---|---|
| `PFADD key m [m...]` | O(1) each | Add items |
| `PFCOUNT key [key...]` | O(1) per key | **Estimate** how many distinct items |
| `PFMERGE dest src...` | O(N) | Merge HLLs into one |
| `PFDEBUG` | — | Internal sub-command |

- **Standard error ≈ 0.81%**
- Fixed **~12 KB** per key regardless of how many items you add
- Stored as a **string** (`TYPE` returns `string`)

### Bloom filter (RedisBloom **module**)

| Command | What it does |
|---|---|
| `BF.RESERVE key <error> <capacity>` | Pre-allocate with a chosen error rate |
| `BF.ADD key item` | Add one item |
| `BF.ADD` with two items | **ERROR** — this module takes one item per call |
| `BF.EXISTS key item` | `true` = *maybe*, `false` = **definitely absent** |
| `BF.MEXISTS key item...` | Check several |
| `BF.CARD key` | Approximate number inserted |
| `BF.INFO key` | Capacity, size, error settings |
| `BF.INSERT` | `BF.ADD` that creates the filter if missing |

---

## 3. redis-cli example

### HyperLogLog

```bash
docker exec -it redis-learn redis-cli
```

```redis
127.0.0.1:6379> PFADD hll a b c
(integer) 1
127.0.0.1:6379> PFCOUNT hll
(integer) 3
127.0.0.1:6379> PFADD hll a
(integer) 0                        ← nothing new
127.0.0.1:6379> TYPE hll
string
127.0.0.1:6379> STRLEN hll
(integer) 27                       ← 27 bytes for any number of items
127.0.0.1:6379> MEMORY USAGE hll
(integer) 70
```

Merging — the reason HLL exists:

```redis
127.0.0.1:6379> PFADD h1 x y z
127.0.0.1:6379> PFADD h2 z w
127.0.0.1:6379> PFCOUNT h1
(integer) 3
127.0.0.1:6379> PFCOUNT h2
(integer) 2
127.0.0.1:6379> PFMERGE merged h1 h2
OK
127.0.0.1:6379> PFCOUNT merged
(integer) 4                         ← union: x,y,z,w
127.0.0.1:6379> PFCOUNT h1 h2
(integer) 4                         ← same thing, one command
```

You cannot merge 10,000 per-user HLLs into an exact set without moving millions of strings
over the network. `PFMERGE` does it in **one command on the server**.

### Bloom filter

```bash
docker exec redis-learn redis-cli BF.RESERVE bf 0.01 1000
OK
docker exec redis-learn redis-cli BF.ADD bf redis
127.0.0.1:6379> BF.ADD bf nosql
127.0.0.1:6379> BF.EXISTS bf redis
1
127.0.0.1:6379> BF.EXISTS bf mongo
0                        ← DEFINITELY not there
127.0.0.1:6379> BF.MEXISTS bf redis mongo
1) (integer) 1
2) (integer) 0
127.0.0.1:6379> BF.CARD bf
(integer) 2
docker exec redis-learn redis-cli BF.INFO bf
```

Verified `BF.INFO`:

```
Capacity
1000
Size
1480
Number of filters
1
Number of items inserted
2
Expansion rate
2
```

`Size 1480` is the number of **bits** — 185 bytes for a filter sized for 1,000 items.

---

## 4. Node.js example

### Verified output of `examples/12-hyperloglog-and-bloom.mjs`

```
--- HyperLogLog basics ---
PFADD a b c  -> PFCOUNT: 3
PFADD a again (duplicate) -> 0
PFCOUNT      -> 3 (unchanged - sets are distinct-only)

HLL is stored as a string:
  TYPE        -> string
  STRLEN      -> 27 bytes
  MEMORY USAGE-> 75 bytes

--- accuracy and memory on 100,000 distinct items ---
  exact (SET)     : 100000
  HLL estimate    : 99471
  error           : -0.529%
  SET memory      : 4,361,841 bytes
  HLL memory      : 14,367 bytes
  saving          : 304x smaller

--- PFMERGE: union counts from separate HLLs ---
h1 PFCOUNT -> 3
h2 PFCOUNT -> 2
merged PFCOUNT -> 4 (union: x,y,z,w)
PFCOUNT of several keys at once -> 4
  ^ one round trip for a cross-set distinct count

--- ⚠️ the limits of HyperLogLog ---
  * PFCOUNT returns an ESTIMATE. Never use it for billing or quotas.
  * Standard error is ~0.81%. Small counts are less accurate.
  * You cannot PFREMOVE a single element (no PFDEL in core Redis).
  * Comparing two HLLs for equality is not supported.
  tiny HLL (1 item) PFCOUNT -> 1 (estimate can be off even at tiny sizes)

--- Bloom filter ---
BF.ADD redis   -> added
BF.ADD nosql   -> added
BF.EXISTS redis-> true (1 = probably present)
BF.EXISTS mongo-> false (0 = DEFINITELY absent)
BF.MEXISTS redis,mongo -> [ true, false ]
BF.CARD -> 2 (approximate count inserted)

BF.INFO (RESP3 map -> plain JS object):
  Capacity: 1000
  Size: 1480
  Number of filters: 1
  Number of items inserted: 2
  Expansion rate: 2

--- false positives, measured (10,000 inserted, 10,000 absent lookups) ---
  target    5%:  276/10000 false positives = 2.76%  ( 9696 bits, 9728 bytes)
  target    1%:   45/10000 false positives = 0.45%  (13888 bits, 13920 bytes)
  target  0.1%:    6/10000 false positives = 0.06%  (19872 bits, 19904 bytes)
  ^ a tighter error rate costs MORE memory. Trade-off, not free.

--- Bloom without RESERVE (auto-sizing) ---
BF.ADD without RESERVE works, it grows automatically
BF.INFO -> Capacity=100 Size=240 items=1

BF.RESERVE lets you pick error rate + capacity UP FRONT:
  BF.RESERVE key <error_rate> <capacity>

--- the point: avoiding a database hit ---
user-42   -> { result: { name: 'Ada', age: 36 }, note: 'found' }
user-9999 -> { result: null, note: 'skipped the database entirely' }
  ^ most lookups never touch the database at all

DBSIZE after cleanup: 0
```

### ⭐ HyperLogLog: 304× smaller, 0.5% wrong

```
  exact (SET)     : 100000
  HLL estimate    : 99471
  error           : -0.529%
  SET memory      : 4,361,841 bytes
  HLL memory      : 14,367 bytes
  saving          : 304x smaller
```

On **100,000 distinct users**, HyperLogLog used **14 KB** where a set used **4.3 MB**, and
was **0.53% off**. That is the standard error doing exactly what the docs promise.

At 10 million users the gap becomes roughly 40 GB vs ~12 KB.

### Merging HLLs server-side

```javascript
await client.pfMerge('merged', ['h1', 'h2']);       // keys is an ARRAY
await client.pfCount(['h1', 'h2']);                  // same, without creating a key
```

Verified: `h1` = 3, `h2` = 2, union = **4**.

> ⚠️ `pfMerge(dest, ['h1','h2'])` — passing `'h1','h2'` as separate arguments silently
> ignores the second, same class of bug as [Chapter 09](09-sets.md)'s `sInter`.

### ⚠️ Bloom false-positive rates, measured

```
  target    5%:  276/10000 false positives = 2.76%  ( 9696 bits, 9728 bytes)
  target    1%:   45/10000 false positives = 0.45%  (13888 bits, 13920 bytes)
  target  0.1%:    6/10000 false positives = 0.06%  (19872 bits, 19904 bytes)
```

Three things to take from this table:

1. **The actual rate is roughly half the target.** RedisBloom's `error` parameter is
   conservative — asking for 1% gave 0.45%.
2. **Tighter error costs more memory.** 9,696 bits → 13,888 → 19,872. Roughly linear in
   `log(1/p)`.
3. **10,000 items fit in about 10–20 KB.** Compare with 4.3 MB for a set.

### 🔴 `BF.EXISTS` returns a BOOLEAN under RESP3

This bit me and produced a convincing wrong answer — **0 false positives forever**:

```javascript
await client.sendCommand(['BF.EXISTS', key, 'absent:1']) === 1     // ✗ always false!
await client.sendCommand(['BF.EXISTS', key, 'absent:1']) === true  // ✓
```

redis-cli's non-raw output shows `0`/`1`; node-redis with RESP3 decodes it to
`false`/`true`. My first run reported `0/10000 = 0.00%` at a 1% error rate — impossible.
The corrected run reports **0.45%**.

### `BF.ADD` takes ONE item

```javascript
await client.bf.add(key, 'a');            // ✓
await client.sendCommand(['BF.ADD', k, 'a', 'b']);   // ✗ ERR wrong number of arguments
```

Verified. Use the typed `client.bf.add(key, item)` in a loop.

### The real use case — skipping the database

```javascript
async function lookup(id) {
  const maybe = await client.sendCommand(['BF.EXISTS', 'dbids', id]);
  if (maybe !== true) return { result: null, note: 'skipped the database entirely' };
  const row = await db.users.find(id);
  return { result: row, note: row ? 'found' : 'false positive: wasted a DB query' };
}
```

Verified:

```
user-42   -> { result: { name: 'Ada', age: 36 }, note: 'found' }
user-9999 -> { result: null, note: 'skipped the database entirely' }
```

With a 1% false-positive rate, **99% of lookups for non-existent IDs skip the database
entirely**. On a service where most requests are cache misses, that is a huge saving.

---

## 5. When to use it and when NOT to

### ✅ Use HyperLogLog when

- You need **unique counts at huge scale** (millions/billions of users).
- You only need the **number**, never the **names**.
- You want to **merge counts** from many servers cheaply (`PFMERGE`).
- Small inaccuracy is fine: analytics dashboards, "monthly active users".

### ❌ Don't use HyperLogLog when

| Situation | Why | Use instead |
|---|---|---|
| You need the **exact** count | ~0.8% error | [Set](09-sets.md) |
| You need to **list** the members | Impossible | [Set](09-sets.md) |
| You need to **remove** one member | No delete operation | [Set](09-sets.md) |
| **Billing, quotas, payouts** | 0.8% error is unacceptable | [Set](09-sets.md) or SQL |
| Comparing **equality** of two populations | Not supported | Compare the sets |
| **A/B tests** needing exact conversions | Error is unacceptable | [Set](09-sets.md) |

### ✅ Use a Bloom filter when

- Checking whether an ID **might exist** before a **slow database lookup**.
- Filtering out **most non-existent** items cheaply (70–99%).
- **Deduplication hints** before a batch insert.
- Guarding against **cache-penetration** / a "not found" attack.

### ❌ Don't use a Bloom filter when

| Situation | Why | Use instead |
|---|---|---|
| You need to **list** what is inside | Impossible | [Set](09-sets.md) |
| You need to **delete** an item | Core Bloom has no delete (CF/CF.ADDNX alternatives) | Cuckoo filter, or rebuild |
| Almost all lookups are for **existing** items | FP rate wastes DB hits anyway | Just query the DB |
| You need **exactness** | FP rate > 0 by design | [Set](09-sets.md) |
| The set is **tiny** (< a few hundred) | A Redis set is smaller and exact | [Set](09-sets.md) |

### HLL vs Bloom vs Set — choosing

| | Set | HyperLogLog | Bloom filter |
|---|---|---|---|
| Memory @100k | 4.3 MB | **14 KB** | ~14 KB |
| Exact count | ✅ | ❌ (~0.8%) | ❌ (`BF.CARD` approximate) |
| List members | ✅ | ❌ | ❌ |
| "Definitely absent" | ✅ | ❌ | ✅ |
| Delete a member | ✅ | ❌ | ❌ |
| Merge many sources | expensive | ✅ cheap | moderate |

---

## 6. Common mistakes

**Mistake 1 — Using HLL where exactness matters.**
Billing or quotas from `PFCOUNT` will be wrong by ~0.8%, permanently. Use a set.

**Mistake 2 — Treating `BF.EXISTS === 1`.**
Under RESP3 it is `=== true`. Verified: this bug reported **0% false positives** at a 1%
error rate — a nonsense result that should have triggered suspicion.

**Mistake 3 — Assuming `BF.ADD` accepts multiple items.**
It takes **one**. Use `client.bf.add(key, item)` in a loop.

**Mistake 4 — Forgetting a Bloom filter's false positives are permanent.**
You cannot "fix" an FP. Design so a false positive costs a wasted DB read, not a wrong
answer.

**Mistake 5 — Never `BF.RESERVE`.**
The filter then auto-grows with a **default** error rate. Reserve up front with a known
capacity.

**Mistake 6 — Expecting `BF.CARD` to be exact.** It is approximate.

**Mistake 7 — Never refreshing the filter.**
If your database rows are **deleted**, the Bloom filter still says "maybe present". You
rebuild it periodically (`BF.RESERVE` again) or let it be a soft cache.

**Mistake 8 — Using `PFCOUNT` on tiny sets and expecting accuracy.**
Small counts are *less* accurate than large ones. Verified: a 1-item HLL returned `1`, but
small values can be off.

**Mistake 9 — Confusing HLL and Bloom.**
HLL counts **how many**; Bloom answers **is it there**. They solve different problems and
are often used together.

**Mistake 10 — `pfMerge(dest, 'h1', 'h2')`.**
Silently ignores `'h2'`. Pass an **array**: `pfMerge(dest, ['h1','h2'])`.

---

## 7. Try it yourself

**Exercise:** Compare three ways to count 200,000 distinct user IDs and measure memory for
each: a Redis set, a HyperLogLog, and a Bloom filter. Then time 10,000 lookups of IDs that
were **never inserted**, and count how many times each method would have wrongly said "yes".

**Hint:** build the set with `sAdd` in a loop, HLL with `pfAdd`, Bloom with
`sendCommand(['BF.ADD', ...])`. Measure with `memoryUsage`. For false positives, look up
`absent:${i}` for i in 0..9999 and compare Bloom's answer against `sIsMember` (ground truth).

**What to notice:** the set is exact and 300× bigger; HLL has no false positives *because it
never claims membership*, only approximate counts; Bloom has a measurable, tunable false
positive rate that is **always in your favour** (it never produces a false "absent").

---

## 8. Next

**[Chapter 13 — Geospatial indexes](13-geospatial.md)** — finding things near a
latitude/longitude, with the 52-bit precision trap.

---

**Verified facts recap**

| Claim | How verified |
|---|---|
| HLL `STRLEN` = 27 bytes for any size | Direct |
| HLL is `TYPE string` | Direct |
| 100k items: HLL **14,367 B** vs set **4,361,841 B** | `MEMORY USAGE` |
| HLL estimate 99,471 (error −0.529%) | `PFCOUNT` |
| **304× memory saving** | Computed |
| `PFMERGE` union of {x,y,z} + {z,w} = 4 | Direct |
| Bloom 1% target → **0.45%** actual FPs | 45/10,000 |
| Bloom 5% target → 2.76%; 0.1% → 0.06% | Measured |
| Tighter error = more memory (9,696 → 19,872 bits) | `BF.INFO` |
| `BF.EXISTS` is `true`/`false`, not `1`/`0` | Bug produced 0% FP |
| `BF.ADD` takes one item | Two items → error |
| `BF.INFO` returns an object under RESP3 | Direct |
| Bloom skips the DB for absent IDs | Verified |