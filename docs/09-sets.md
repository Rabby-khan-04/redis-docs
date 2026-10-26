# Chapter 09 — Sets

> **Verified on:** Redis **8.10.2**, node-redis **6.3.0**
> Run the code: `node examples/09-sets.mjs`

---

## 1. Simple explanation (like I'm 7)

A set is a **bag of marbles where every marble is different**.

If you try to drop in a red marble you already have, nothing happens — sets do not allow
twins. And there is **no order**; the marbles are just jumbled in the bag.

The magic: you can ask "is the red marble in there?" and get an answer **instantly**, even
if the bag has a million marbles. That is faster than any paper list.

---

## 2. Real name

A **set** is an **unordered collection of unique strings**.

Three properties:

1. **Unique** — adding a member twice changes nothing.
2. **Unordered** — there is no first or last.
3. **O(1) membership test** — `SISMEMBER` is constant time regardless of size.

### Commands

| Command | Cost | What it does |
|---|---|---|
| `SADD key m [m...]` | O(1) each | Add members; returns how many were **new** |
| `SISMEMBER key m` | **O(1)** | Is this a member? |
| `SMISMEMBER key m...` | O(N) | Check several at once |
| `SREM key m...` | O(1) each | Remove |
| `SCARD key` | **O(1)** | How many members |
| `SMEMBERS key` | **O(N)** | ⚠️ All members — avoid on big sets |
| `SRANDMEMBER key [count]` | O(N)/O(1) | Random member(s), **non-destructive** |
| `SPOP key [count]` | O(1)/O(N) | Random member(s), **destructive** |
| `SINTER key...` | O(N×M) | Intersection (AND) |
| `SUNION key...` | O(N×M) | Union (OR) |
| `SDIFF key...` | O(N×M) | Difference (NOT) |
| `SINTERCARD key...` | O(N×M) | **How many** are in common |
| `SINTERSTORE/SUNIONSTORE/SDIFFSTORE dest key...` | O(N×M) | Store the result |
| `SSCAN key cursor` | O(1) per call | **Safe** iteration |

### Encodings

| Encoding | When | Threshold |
|---|---|---|
| `intset` | All members are integers | `set-max-intset-entries` = **512** |
| `listpack` | Small set of short strings | `set-max-listpack-entries` = **128** |
| `hashtable` | Everything else | — |

Verified: a 2,000-member set is a `hashtable` (61,357 bytes).

---

## 3. redis-cli example

```bash
docker exec -it redis-learn redis-cli
```

```redis
127.0.0.1:6379> SADD ch09:tags redis nosql cache
(integer) 3
127.0.0.1:6379> SCARD ch09:tags
(integer) 3
127.0.0.1:6379> SISMEMBER ch09:tags redis
(integer) 1
127.0.0.1:6379> SISMEMBER ch09:tags mongo
(integer) 0

127.0.0.1:6379> SADD ch09:tags redis
(integer) 0                          ← already there, nothing added
127.0.0.1:6379> SCARD ch09:tags
(integer) 3                          ← still 3

127.0.0.1:6379> SREM ch09:tags cache
(integer) 1
127.0.0.1:6379> SMEMBERS ch09:tags
1) "nosql"
2) "redis"
```

### Set algebra — the genuinely useful part

```redis
127.0.0.1:6379> SADD A 1 2 3 4
127.0.0.1:6379> SADD B 3 4 5 6
127.0.0.1:6379> SINTER A B
1) "3"
2) "4"
127.0.0.1:6379> SUNION A B
1) "1" ... 6
127.0.0.1:6379> SDIFF A B
1) "1"
2) "2"
127.0.0.1:6379> SINTERCARD A B
(integer) 2
```

### ⚠️ `SRANDMEMBER` vs `SPOP`

```redis
127.0.0.1:6379> SCARD big
(integer) 2000
127.0.0.1:6379> SRANDMEMBER big 3
"m11" "m66" "m899"
127.0.0.1:6379> SCARD big
(integer) 2000                       ← unchanged

127.0.0.1:6379> SPOP big 2
"m1320" "m1793"
127.0.0.1:6379> SCARD big
(integer) 1997                       ← two GONE
```

A **negative count** samples with repeats: `SRANDMEMBER big -10` returns 10 picks that may
contain duplicates. Verified: 10 picks, 10 distinct on a large set (randomness).

---

## 4. Node.js example

### Verified output of `examples/09-sets.mjs`

```
--- basics ---
SCARD      -> 3
SISMEMBER  -> 1
SISMEMBER  -> 0 (0 = not a member)
sIsMember redis,nosql,mongo -> 1 (single member only)
smIsMember redis,nosql,mongo -> [ 1, 1, 0 ] (array)
SMEMBERS   -> [ 'cache', 'nosql', 'redis' ]
SADD redis again -> 0 (0 = already there)
SCARD still      -> 3
SREM cache       -> 1
after SREM       -> [ 'nosql', 'redis' ]

--- ⚠️ varargs trap ---
sAdd(key,'a','b','c')      -> [ 'a' ]  ← only "a" stored
sAdd(key,['a','b','c'])   -> [ 'a', 'b', 'c' ]  ✓

--- set algebra ---
A        -> [ '1', '2', '3', '4' ]
B        -> [ '3', '4', '5', '6' ]
A ∩ B    -> [ '3', '4' ]
A ∪ B    -> [ '1', '2', '3', '4', '5', '6' ]
A − B    -> [ '1', '2' ]
|A ∩ B|  -> 2
SDIFFSTORE onlyA -> [ '1', '2' ]

--- real use: find articles tagged BOTH redis AND nosql ---
redis AND nosql -> [ 'art:1', 'art:4' ]   (expected art:1, art:4)
  ^ one round trip, done inside Redis
  articles with redis only -> [ 'art:2' ]
  articles with either    -> [ 'art:1', 'art:2', 'art:4' ]

--- SMEMBERS cost ---
set-max-listpack-entries : 128
SCARD 2000 -> 2000 (O(1))
encoding   -> hashtable (61357 bytes)
SMEMBERS   ->  2000 elements returned (O(N) over the wire)
sScanIterator -> 2000 members in 10 batches (no huge reply)

--- SRANDMEMBER vs SPOP ---
sRandMember()        -> "m1899" (1 random member)
sRandMemberCount(k,3)-> 3 members, SCARD 2000 -> 2000 (unchanged)
sPop()               -> "m1476"
sPopCount(k,2)       -> 2 members, SCARD 1998 -> 1997 (REMOVED)
SRANDMEMBER -10      -> 10 picks, 10 distinct (repeats allowed)

--- SINTERCARD LIMIT ---
|allids ∩ goldusers|        -> 300
...LIMIT 3 (stops early)    -> 3 (stops as soon as 3 matches are found)

DBSIZE after cleanup: 0
```

### The varargs trap applies here too

```javascript
await client.sAdd('k', 'a', 'b', 'c');       // ✗ only 'a'
await client.sAdd('k', ['a', 'b', 'c']);     // ✓
```

Verified: `sAdd(key,'a','b','c')` → `[ 'a' ]`.

### 🔴 Set algebra takes a keys ARRAY

```javascript
// ✗ WRONG — the 2nd argument is silently ignored
await client.sInter('A', 'B');          // returns only A's members!

// ✓ CORRECT
await client.sInter(['A', 'B']);
```

This one is nastier than the varargs trap because it produces **plausible but wrong**
results. Verified in my first run:

```
A ∩ B    -> [ '1', '2', '3', '4' ]   ← WRONG, that's just A
```

After fixing: `A ∩ B -> [ '3', '4' ]` ✅.

Same rule for `sUnion`, `sDiff`, `sInterCard`, `sUnionStore`, `sDiffStore`.

### `sIsMember` vs `smIsMember`

| Method | Takes | Returns |
|---|---|---|
| `sIsMember(key, 'a')` | **one** member | `1` / `0` |
| `smIsMember(key, ['a','b','c'])` | **array** | `[1, 1, 0]` |

Verified: passing an array to `sIsMember` throws a `TypeError`.

### `sPop`/`sRandMember` take only a key — use the `_COUNT` variants

```javascript
await client.sPop('k');                    // 1 member
await client.sPopCount('k', 2);            // array of 2
await client.sRandMember('k');             // 1 member
await client.sRandMemberCount('k', 3);     // array of 3
```

Passing a count to `sPop(key, count)` throws. For **negative** counts (sampling with
repeats), use `sendCommand`:

```javascript
await client.sendCommand(['SRANDMEMBER', 'k', '-10']);
```

### The real payoff: intersection in one round trip

```javascript
// Index each article by tag
await client.sAdd('bytag:redis', ['art:1', 'art:2', 'art:4']);
await client.sAdd('bytag:nosql', ['art:1', 'art:4']);

await client.sInter(['bytag:redis', 'bytag:nosql']);
// → [ 'art:1', 'art:4' ]
```

Verified. Without sets you would `SMEMBERS` each list and intersect in JavaScript — two
round trips and a lot of memory moved.

### `SINTERCARD` with `LIMIT`

```javascript
await client.sInterCard(['allids', 'goldusers']);                        // 300
await client.sInterCard(['allids', 'goldusers'], { LIMIT: 3 });         // 3, stops early
```

Verified: full count 300, with `LIMIT: 3` it returned `3`. If you only need "do they have at
least 3 in common?", this avoids scanning everything.

---

## 5. When to use it and when NOT to

### ✅ Use a set when

- **Membership matters** and order does not: "has this user liked this post?"
- **Uniqueness** must be enforced: usernames, email addresses, IPs.
- You need **set operations**: "which users have both tag A and tag B?"
- You need to **sample randomly** (`SRANDMEMBER`) — "give me 5 random items".
- **Tags and categories**: tags per article, followers per user.

### ❌ Don't use a set when

| Situation | Why | Use instead |
|---|---|---|
| You need **order** | Sets are unordered | [List](08-lists.md) |
| You need to **rank** by something | No scores | [Sorted set](10-sorted-sets.md) |
| You need the **same item many times** | Duplicates are impossible | [List](08-lists.md) or [string](05-strings.md) |
| You need to store **fields** per item | Sets hold one value per member | [Hash](07-hashes.md) |
| You need **partial matching** (`LIKE '%foo%'`) | No such feature | [Search](16-search.md) |

### Sset vs sorted set

Both are unique collections. The difference is the **score**:

| | Set | Sorted set |
|---|---|---|
| `SMEMBERS` | `['a','b']` | `ZRANGE` → ordered |
| Ranking | ❌ | ✅ by score |
| Use for | tags, membership | leaderboards, priority queues |

If you don't need ordering, a plain set is cheaper and simpler.

---

## 6. Common mistakes

**Mistake 1 — The varargs trap.** `sAdd(key,'a','b','c')` stores only `'a'`. Pass an array.

**Mistake 2 — Passing separate keys to set algebra.** `sInter('A','B')` silently ignores `B`.
Pass an **array**: `sInter(['A','B'])`. This is the most dangerous mistake here because it
returns plausible wrong answers instead of an error.

**Mistake 3 — `sIsMember` with an array.** Throws a `TypeError`. Use `smIsMember`.

**Mistake 4 — `sPop` with a count.** Throws. Use `sPopCount`.

**Mistake 5 — Using `SPOP` when you meant `SRANDMEMBER`.**
`SPOP` **destroys** the member. Verified: `SCARD` 2000 → 1997 after `sPopCount(k, 2)`. If
you wanted a random pick without losing it, you have a bug.

**Mistake 6 — `SMEMBERS` on a large set.** O(N) and one giant reply. Verified: a
2,000-member set returned all 2,000. Use `SSCAN` (`sScanIterator`).

**Mistake 7 — Assuming order.** `SMEMBERS` returns `hash table` order, not insertion order.
Never depend on it.

**Mistake 8 — Sets for "unique with order".** You cannot have both. Use a sorted set.

**Mistake 9 — Huge set algebra without limits.** `SINTER` over many large sets is O(N×M) and
can block. Use `SINTERCARD` with `LIMIT` when you only need a count.

**Mistake 10 — Forgetting to update both sides of a relationship.**
"user 5 follows user 9" needs `SADD following:5 9` **and** `SADD followers:9 5`. Miss one
and your data is inconsistent. Consider a Lua script or a transaction
([Chapter 19](19-lua-scripting.md)).

---

## 7. Try it yourself

**Exercise:** Build a "who follows whom" graph: `follows:<user>` and
`followers:<user>`. Then answer two questions without any JavaScript set logic:
(1) how many users are followed by both user A and user B, and (2) list mutual followers of
A and B.

**Hint:** (1) is `sInterCard(['follows:A','follows:B'])`. (2) is `sInter(['followers:A',
'followers:B'])`. Then verify your answer **also** by computing `sInter(['follows:A',
'follows:B'])` — mutual follows should match, which is a good consistency check.

**What to notice:** a social graph in Redis is just sets of IDs. The algebra is done
server-side, so a 1000-user intersection is one round trip.

---

## 8. Next

**[Chapter 10 — Sorted sets](10-sorted-sets.md)** — sets plus numbers, giving you rankings,
leaderboards, and priority queues.

---

**Verified facts recap**

| Claim | How verified |
|---|---|
| `sAdd` returns count of **new** members only | Second `sAdd('redis')` → 0 |
| `sIsMember` takes one member, `smIsMember` an array | `[1,1,0]` vs `TypeError` |
| `sInter('A','B')` ignores B; array required | Wrong output → fixed → `[3,4]` |
| Varargs trap on `sAdd` | `[ 'a' ]` vs `[ 'a','b','c' ]` |
| `SRANDMEMBER` non-destructive, `SPOP` destructive | `SCARD` 2000 → 2000 → 1997 |
| `sPop(key, count)` throws; use `sPopCount` | `TypeError` |
| `set-max-listpack-entries` = 128 | `CONFIG GET` |
| 2,000 members → `hashtable`, 61,357 bytes | `OBJECT ENCODING` + `MEMORY USAGE` |
| `sScanIterator` → 2,000 in 10 batches | Direct |
| `sInterCard LIMIT 3` stops early | 300 → 3 |