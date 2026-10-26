# Chapter 10 — Sorted sets

> **Verified on:** Redis **8.10.2**, node-redis **6.3.0**
> Run the code: `node examples/10-sorted-sets.mjs`

---

## 1. Simple explanation (like I'm 7)

A sorted set is a **list of competitors where everyone has a score**.

Everyone is unique (like a set), but they are **kept in order by their score**. So you can
always ask:

- "Who is first?" → highest score
- "Where am I in the line?" → my rank
- "Everyone scoring between 100 and 200?" → a range
- "Give me the top 10" → instant

You never have to sort anything yourself.

---

## 2. Real name

A **sorted set** (`zset`) is a set of unique members where each member has a **float
score**, kept in order by that score.

Two structures work together inside:

- a **hash table** for `member → score` lookups (`ZSCORE`, O(1))
- a **skip list** for ordering (`ZRANK`, O(log N))

### Commands

| Command | Cost | What it does |
|---|---|---|
| `ZADD key score member` | O(log N) | Add / update |
| `ZSCORE key member` | **O(1)** | The member's score |
| `ZMSCORE key m...` | O(N) | Several scores, one round trip |
| `ZCARD key` | **O(1)** | How many members |
| `ZRANGE key start stop` | O(log N + M) | By **rank**, ascending |
| `ZREVRANGE key start stop` | O(log N + M) | By **rank**, descending |
| `ZRANK key member` | **O(log N)** | 0-based rank, lowest score first |
| `ZREVRANK key member` | **O(log N)** | 0-based rank, highest score first |
| `ZINCRBY key delta member` | **O(log N)** | Atomic score increment |
| `ZRANGEBYSCORE key min max` | O(log N + M) | By **score** range |
| `ZCOUNT key min max` | O(log N) | How many in a score range |
| `ZPOPMIN` / `ZPOPMAX` | O(log N) | Remove the lowest / highest |
| `ZRANGEBYLEX key min max` | O(log N + M) | Alphabetical (all scores equal) |
| `ZUNION`/`ZINTER`/`ZDIFF` | O(N×M log M) | Set algebra on scores |
| `ZSCAN key cursor` | O(1) per call | **Safe** iteration |

### Range syntax

| Syntax | Meaning |
|---|---|
| `10` | score = 10 (inclusive) |
| `(10` | score **>** 10 (exclusive) |
| `-inf` `+inf` | unbounded |
| `LIMIT offset count` | paginate the result |

### Encodings

| Encoding | When | Threshold |
|---|---|---|
| `listpack` | Small: ≤ 128 entries **and** values ≤ 64 bytes | `zset-max-listpack-entries` = **128** |
| `skiplist` + `dict` | Everything else | — |

Verified: 3 members → `listpack` (43 bytes); 300 members → `skiplist` (25,436 bytes).

---

## 3. redis-cli example

```bash
docker exec -it redis-learn redis-cli
```

```redis
127.0.0.1:6379> ZADD lb 10 alice 20 bob 5 carol
(integer) 3
127.0.0.1:6379> ZSCORE lb bob
"20"
127.0.0.1:6379> ZSCORE lb nobody
(nil)

127.0.0.1:6379> ZRANGE lb 0 -1 WITHSCORES
1) "carol"
2) "5"
3) "alice"
4) "10"
5) "bob"
6) "20"

127.0.0.1:6379> ZREVRANGE lb 0 -1 WITHSCORES
1) "bob"
2) "20"
3) "alice"
4) "10"
5) "carol"
6) "5"

127.0.0.1:6379> ZINCRBY lb 15 alice
"25"
```

### Leaderboard: top N and rank

```redis
127.0.0.1:6379> ZREVRANGE lb 0 0 WITHSCORES      # top 1
1) "bob"
2) "20"
127.0.0.1:6379> ZREVRANK lb bob
(integer) 0                                       # best = 0
127.0.0.1:6379> ZRANK lb bob
(integer) 2                                       # lowest score = 0
```

### Query by score

```redis
127.0.0.1:6379> ZRANGEBYSCORE lb 10 30
1) "bob"
2) "alice"
127.0.0.1:6379> ZRANGEBYSCORE lb (10 +inf         # exclusive lower bound
1) "bob"
2) "alice"
127.0.0.1:6379> ZRANGEBYSCORE lb -inf 30 LIMIT 0 1   # paginate
1) "carol"
127.0.0.1:6379> ZCOUNT lb 10 30
(integer) 2
```

### 🔴 The `REV` argument-order trap

`ZRANGE ... BYSCORE REV` **reverses min/max**:

```redis
127.0.0.1:6379> ZRANGE zz 5 +inf BYSCORE
"a" "b" "c"
127.0.0.1:6379> ZRANGE zz 5 +inf BYSCORE REV
(empty array)                    ← ⚠️ WRONG ORDER, returns nothing!
127.0.0.1:6379> ZRANGE zz +inf 5 BYSCORE REV       # ← max first!
"c" "b" "a"
```

Verified: `ZRANGE zz 5 +inf BYSCORE REV` returned **empty**, while `ZRANGE zz +inf 5
BYSCORE REV` returned `c b a`.

---

## 4. Node.js example

### Verified output (key parts of `examples/10-sorted-sets.mjs`)

```
--- basics ---
ZCARD      -> 3
ZSCORE bob -> 20
ZSCORE zzz -> null (null = not a member)
ZRANGE asc -> [ {carol,5}, {alice,10}, {bob,20} ]
ZREVRANGE  -> [ {bob,20}, {alice,10}, {carol,5} ]

--- leaderboard ---
ZINCRBY alice 15 -> 25
ZINCRBY alice 5  -> 30 (alice is now 30)
board (best first) -> [ {alice,30}, {bob,20}, {carol,5} ]
alice rank (0-based, best=0) -> 2
ZREVRANK (best = 0)          -> 0
alice rank with score        -> { rank: 2, score: 30 }

--- top N ---
top 2 -> [ {alice,30}, {bob,20} ]

--- by score ---
ZRANGEBYSCORE 10..30      -> [ {bob,20}, {alice,30} ]
ZRANGEBYSCORE (10..+inf   -> [ {bob,20}, {alice,30} ]   ("(" means EXCLUSIVE)
ZRANGEBYSCORE -inf..(20   -> [ {carol,5} ]
ZCOUNT 10..30             -> 2

--- unified ZRANGE ---
ZRANGE BYSCORE      -> [ 'bob', 'alice' ]
ZRANGE BYSCORE REV  -> [ 'alice', 'bob' ]   (note: REV flips min/max order!)

--- ZPOPMIN / ZPOPMAX ---
zPopMin()    -> { value: 'carol', score: 5 }
zPopMax()    -> { value: 'alice', score: 30 }
remaining -> [ { value: 'bob', score: 20 } ]

--- ZMSCORE (one round trip) ---
alice,bob,nobody -> [ 10, 20, null ]

--- set algebra on sorted sets ---
z1 -> [ {a,10}, {b,20} ]
z2 -> [ {c,5}, {a,15} ]
UNION (values only)      -> [ 'c', 'b', 'a' ]
UNION SUM (with scores)  -> [ {c,5}, {b,20}, {a,25} ]
UNION MAX (with scores)  -> [ {c,5}, {a,15}, {b,20} ]
INTER                    -> [ 'a' ]
INTER WITHSCORES         -> [ { value: 'a', score: 15 } ]
DIFF (z1 - z2)           -> [ 'b' ]

--- priority queue ---
next job to run (lowest score) -> { value: 'critical', score: 1 }
then -> { value: 'normal', score: 5 }

--- lexical order (all score 0) ---
ZRANGEBYLEX - +    -> [ 'alice', 'bob', 'carol' ]
ZRANGEBYLEX [a c)  -> [ 'alice', 'bob' ]

--- encoding ---
zset-max-listpack-entries : 128
3 small members -> listpack (43 bytes)
300 members     -> skiplist (25436 bytes)

ZRANK in a 50000-member zset: 0.20ms (skip list = O(log N))
Full ZRANGE of 50000 members:    39.4ms (O(N) -- don't do this)
```

### 🔴 The skip list payoff, measured

```
ZRANK in a 50000-member zset: 0.20ms (skip list = O(log N))
Full ZRANGE of 50000 members:    39.4ms (O(N) -- don't do this)
```

**197× difference** on the same key. `ZRANK` walks a skip list and touches ~log₂(50000) ≈
16 nodes. `ZRANGE 0 -1` returns everything and blocks the server for 39 ms doing it.

The lesson: **ask for the rank or the top N, never the whole set.**

### `ZRANK` vs `ZREVRANK` — easy to get backwards

```javascript
await client.zRank(P + 'lb', 'alice');     // 2  → by ASCENDING score (lowest first)
await client.zRevRank(P + 'lb', 'alice');  // 0  → by DESCENDING score (highest first)
```

For a leaderboard, "1st place" is `zRevRank() === 0`. Verified: alice with score 30 (the
best) got `zRevRank → 0` and `zRank → 2`.

`zRankWithScore` gives both at once:

```javascript
await client.zRankWithScore('lb', 'alice');   // { rank: 2, score: 30 }
```

### 🔴 `zUnion`'s options object has NO `WITHSCORES`

This is a quiet trap. `ZUnionOptions` only accepts `AGGREGATE`:

```javascript
await client.zUnion(['z1','z2'], { WITHSCORES: true });     // ✗ silently ignores WITHSCORES
await client.zUnionWithScores(['z1','z2']);                 // ✓
```

Verified — my first run printed values only:

```
UNION (SUM default) -> [ 'c', 'b', 'a' ]          ← no scores despite WITHSCORES: true
UNION SUM (with scores) -> [ {c,5}, {b,20}, {a,25} ]   ✓
```

And `zDiff` takes **only** the keys array — no options at all:

```javascript
await client.zDiff(['z1','z2']);                // values
await client.zDiffWithScores(['z1','z2']);      // {value, score}[]
```

### Score aggregation

| `AGGREGATE` | Result for shared member `a` (scores 10 and 15) |
|---|---|
| `SUM` (default) | 25 |
| `MIN` | 10 |
| `MAX` | 15 |
| `COUNT` | 2 (number of sets containing it) |

Verified: `UNION SUM → {a,25}`, `UNION MAX → {a,15}`.

### Sorted set as a priority queue

Invert the score: **lower = more urgent**.

```javascript
await client.zAdd('jobs', [
  { score: 1, value: 'critical' },
  { score: 5, value: 'normal' },
  { score: 9, value: 'low' },
]);

await client.zPopMin('jobs');   // { value: 'critical', score: 1 }  ✓
```

Verified. This is how you build a retry queue, a delayed-job scheduler, or a
lowest-latency-first work queue.

### Lexicographic ranges need equal scores

```javascript
await client.zAdd('names', [
  { score: 0, value: 'alice' }, { score: 0, value: 'bob' }, { score: 0, value: 'carol' },
]);

await client.zRangeByLex('names', '-', '+');      // [ 'alice','bob','carol' ]
await client.zRangeByLex('names', '[a', '(c');    // [ 'alice','bob' ]
```

Lexical ranges only make sense when **every score is identical**, otherwise results are
undefined-ish. Use it for "names starting with A" over a known-fixed roster.

---

## 5. When to use it and when NOT to

### ✅ Use a sorted set when

- **Leaderboards**: scores, points, likes, high scores.
- **Ranking**: "what is my position?"
- **Priority queues**: lowest score first.
- **Score-range queries**: "everyone between 1000 and 2000 points."
- **Delayed jobs**: score = the unix timestamp when it should run.
- **Time-based windows**: score = timestamp, so old entries fall out of range.

### ❌ Don't use a sorted set when

| Situation | Why | Use instead |
|---|---|---|
| You need the **full list** regularly | `ZRANGE 0 -1` is O(N) — 39 ms at 50k | Paginate with `LIMIT` |
| Scores are **timestamps you only filter by** | Overkill | [String](05-strings.md) + `SCAN` |
| You need **membership only** | Set is cheaper | [Set](09-sets.md) |
| You need **ties broken by another field** | One score per member | Add a tiebreaker to the score |
| Members need **multiple attributes** | One score each | [Hash](07-hashes.md) + zset for ranking |

### Two-key pattern

A very common design: keep the **rank** in a sorted set and the **details** in a hash.

```
lb:weekly        sorted set   member -> score
player:42        hash         fields -> values
```

Then `zRangeWithScores('lb:weekly', 0, 99)` for the leaderboard, and `hGetAll('player:42')`
for one player's details. Don't stuff a whole player object into the member name.

---

## 6. Common mistakes

**Mistake 1 — `ZRANGE 0 -1` in a request path.**
39 ms and a giant reply on 50k members. Use `ZRANGE 0 99` or paginate with `LIMIT`.

**Mistake 2 — Confusing `ZRANK` with `ZREVRANK`.**
1st place is `zRevRank() === 0`, **not** `zRank() === 0`.

**Mistake 3 — The `REV` argument-order trap.**
`ZRANGE k 5 +inf BYSCORE REV` returns **empty**. With `REV`, pass **max first**:
`ZRANGE k +inf 5 BYSCORE REV`. Verified.

**Mistake 4 — `zUnion` with `{ WITHSCORES: true }`.**
Silently ignored. Use `zUnionWithScores`. Verified.

**Mistake 5 — `zPopMin(key, count)` / `zPopMax(key, count)`.**
These take **only a key**. Use `zPopMinCount` / `zPopMaxCount`.

**Mistake 6 — Float precision.**
Scores are **IEEE 754 doubles**. `0.1 + 0.2 !== 0.3`. Verified in
[Chapter 05](05-strings.md): `INCRBYFLOAT` gave `10.6`, not a rounding surprise, but don't
assume exact equality. Use integers, or `ZADD ... INCR` for money.

**Mistake 7 — Using `ZRANGEBYLEX` with mixed scores.**
Lexical ordering is only defined when all scores are equal.

**Mistake 8 — Forgetting that the score is a double, not an integer.**
`ZSCORE` returns `"20"` (a string) from redis-cli; node-redis gives you the number.

**Mistake 9 — Assorting a whole set into one string.** No. Sorted sets exist precisely so
you don't have to.

**Mistake 10 — Deleting by score range without checking.** `ZREMRANGEBYSCORE key 0 1000`
can delete half your leaderboard in one command. There is no undo.

---

## 7. Try it yourself

**Exercise:** Build a leaderboard of 10 players. Give the top player 100 points, then use
`ZINCRBY` three times to add points and watch their rank change after each one. Finally,
print the top 3 and find out how many players have between 50 and 200 points.

**Hint:** `zIncrBy(key, delta, member)`, then `zRangeWithScores(key, 0, 2, { REV: true })`
for the top 3, and `zCount(key, 50, 200)` for the range.

**Stretch:** try to discover `ZRANGE k 5 +inf BYSCORE REV` returns nothing, then flip the
arguments and get it working. That argument-order quirk has caught out senior engineers.

---

## 8. Next

**[Chapter 11a — Bitmaps and bitfields](11a-bitmaps.md)** — packing one bit per user into a
string, and counting "how many users were active this week" in constant time.

---

**Verified facts recap**

| Claim | How verified |
|---|---|
| `zRank` = ascending, `zRevRank` = descending | alice(30): rank 2 vs 0 |
| `ZRANGE ... BYSCORE REV` needs max first | Wrong order → empty array |
| `ZRANK` in 50k zset = 0.20 ms | Measured |
| Full `ZRANGE` of 50k = 39.4 ms (O(N)) | Measured |
| `zUnion` ignores `{WITHSCORES:true}` | Values only; `zUnionWithScores` fixed it |
| `zDiff` takes only a keys array | Signature check |
| `zPopMin`/`zPopMax` take only a key | `zPopMinCount` is the counted variant |
| `AGGREGATE SUM/MAX` on shared member | a: 25 vs 15 |
| `zInterCard LIMIT` stops early | [Ch. 09](09-sets.md) |
| `zset-max-listpack-entries` = 128 | `CONFIG GET` |
| 3 members `listpack` (43 B) → 300 `skiplist` (25,436 B) | `OBJECT ENCODING` + `MEMORY USAGE` |
| Lexical range `[a` `(c` → alice, bob | Direct |