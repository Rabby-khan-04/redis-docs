# Chapter 11b — Bitmaps (part 2): BITOP and real analytics

> **Verified on:** Redis **8.10.2**, node-redis **6.3.0**
> Run the code: `node examples/11b-bitmaps-analytics.mjs`
> Continue from [Chapter 11a](11a-bitmaps.md).

---

## 1. Simple explanation (like I'm 7)

You have one row of switches per day:

```
Monday:   user 0,1,2,3
Tuesday:  user 2,3,4
```

Now you want to know:

- Who was there **both** days? → AND the two rows together
- Who was there **at least one** day? → OR them
- Who was there **only one** day? → XOR them
- Who was **never** there Monday? → NOT Monday

That's it. You line the rows up and compare them switch by switch. `BITOP` is the tool
that does the lining-up.

---

## 2. Real name

`BITOP` performs **bitwise logic** on whole strings (Redis calls them bitmaps here).

```
BITOP <operation> <destKey> <key> [<key> ...]
```

| Operation | Meaning | Inputs |
|---|---|---|
| `AND` | Result bit is 1 if **all** sources have 1 | 1+ |
| `OR` | Result bit is 1 if **any** source has 1 | 1+ |
| `XOR` | Result bit is 1 if an **odd** number of sources have 1 | 1+ |
| `NOT` | **Inverts** the source | exactly 1 |

Returns the **size in bytes** of the destination string.

### Combining AND, OR, NOT

`BITOP` takes exactly one operation, but you can chain calls, and `NOT` needs a key first:

```
BITOP AND both  mon tue
BITOP OR  either mon tue
BITOP NOT notmon mon
BITOP AND bothDaysNotTue both nottue
```

### Complexity

All four operations are **O(N/8)** where N is the size in **bytes** of the longest input.
They also allocate memory for the destination.

---

## 3. redis-cli example

```bash
docker exec -it redis-learn redis-cli
```

Build two day bitmaps:

```redis
127.0.0.1:6379> SETBIT day1 0 1
127.0.0.1:6379> SETBIT day1 1 1
127.0.0.1:6379> SETBIT day1 2 1
127.0.0.1:6379> SETBIT day1 3 1
127.0.0.1:6379> SETBIT day2 2 1
127.0.0.1:6379> SETBIT day2 3 1
127.0.0.1:6379> SETBIT day2 4 1
```

Now combine them:

```redis
127.0.0.1:6379> BITOP AND both day1 day2
(integer) 1
127.0.0.1:6379> BITCOUNT both
(integer) 2                     ← users 2 and 3 were active BOTH days

127.0.0.1:6379> BITOP OR either day1 day2
(integer) 1
127.0.0.1:6379> BITCOUNT either
(integer) 5                     ← users 0,1,2,3,4

127.0.0.1:6379> BITOP XOR exactlyone day1 day2
(integer) 1
127.0.0.1:6379> BITCOUNT exactlyone
(integer) 3                     ← users 0, 1, 4

127.0.0.1:6379> BITOP NOT notday1 day1
(integer) 1
127.0.0.1:6379> BITCOUNT notday1
(integer) 4                     ← everyone EXCEPT users 0,1,2,3
```

⚠️ **`BITCOUNT notday1` is 4 only because the bitmap is tiny.** `NOT` flips every bit in the
string, so the string grows to the length of the source and every 0 becomes 1. For a real
bitmap this yields "all possible users", not a small set. Use `NOT` mainly as an input to
another `AND`.

### Chaining to get set-difference

"Absent on Tuesday" is `NOT day2`, then `AND` with `day1`:

```redis
127.0.0.1:6379> BITOP NOT nottue day2
(integer) 1
127.0.0.1:6379> BITOP AND mondayNotTuesday day1 nottue
(integer) 1
127.0.0.1:6379> BITCOUNT mondayNotTuesday
(integer) 2                     ← users 0 and 1
```

---

## 4. Node.js example

### Verified output of `examples/11b-bitmaps-analytics.mjs`

```
--- BITOP ---
day1 bits 0-5 -> 111100 (users 0,1,2,3)
day2 bits 0-5 -> 001110 (users 2,3,4)
AND  (both days)     -> 001100   users 2,3
OR   (either day)    -> 111110   users 0,1,2,3,4
XOR  (exactly one)   -> 110010   users 0,1,4
NOT  (invert day1)   -> 000011   (all EXCEPT 0,1,2,3)
BITCOUNT of AND      -> 2 = users active on BOTH days

--- BITPOS ---
first set bit in day1   -> 0
first unset bit in day1 -> 4
BITPOS only searches FORWARD. `bitPos(key, 1, -1)` still gives the first
bit of the LAST byte -- there is no built-in "last set bit".
  bitPos(day1,1,-1) -> 0

--- real analytics: weekly unique users ---
50 users, 40% chance of activity each day:
  mon: BITCOUNT=20
  tue: BITCOUNT=22
  wed: BITCOUNT=20
  thu: BITCOUNT=20
  fri: BITCOUNT=21

OR of all 5 days, BITCOUNT -> 44 unique users in the week
  (sum of daily counts is much larger: 103)

daily unique vs returning:
  mon: active=20 new=20 returning=0
  tue: active=22 new=13 returning=9
  wed: active=20 new=5 returning=15
  thu: active=20 new=5 returning=15
  fri: active=21 new=1 returning=20

--- bit offset maths ---
8 bits   = 1 byte   -> ceil(8/8)   = 1 byte
100 bits = 12.5 B   -> ceil(100/8) = 13 bytes
1,000,000 bits      -> ceil(1e6/8) = 125000 bytes = 122 KB
SETBIT 99 -> STRLEN 13 bytes (bit 99 is in byte 12)

--- is BITCOUNT fast? ---
bitmap of 1,000,000 bits with 250,000 set
  bytes  -> 125000
  BITCOUNT -> 250000 in 0.14ms
  O(number of bytes) -- 125 KB to walk. Fast, but NOT O(1).

DBSIZE after cleanup: 0
```

### Using `BITOP` from node-redis

There is no typed helper, so use `sendCommand`:

```javascript
await client.sendCommand(['BITOP', 'AND', dest, src1, src2]);
await client.sendCommand(['BITOP', 'OR', dest, ...days.map(d => `days:${d}`)]);  // variadic
```

Verified: `BITOP AND` produced `001100` and `BITCOUNT` of it returned `2`.

### ⭐ The analytics payoff — weekly unique users

```
mon: BITCOUNT=20
tue: BITCOUNT=22
wed: BITCOUNT=20
thu: BITCOUNT=20
fri: BITCOUNT=21

OR of all 5 days, BITCOUNT -> 44 unique users in the week
  (sum of daily counts is much larger: 103)
```

Five days produced **103 activity events**, but only **44 distinct users**. Getting that
44 correctly (a user active 3 times counts once) is exactly the hard part, and here it is:

```javascript
await client.sendCommand(['BITOP', 'OR', 'week', ...days.map(d => `w:${d}`)]);
const weekUnique = await client.bitCount('week');   // 44
```

**One command.** Without bitmaps you would fetch 5 sets (103 members), union them in
JavaScript, and risk a Set that grows to hundreds of thousands of entries.

### Daily new vs returning users

```
daily unique vs returning:
  mon: active=20 new=20 returning=0
  tue: active=22 new=13 returning=9
  wed: active=20 new=5  returning=15
  thu: active=20 new=5  returning=15
  fri: active=21 new=1  returning=20
```

Also pure `BITOP`: `new_today = today AND NOT (mon OR tue OR ...)`, then `BITCOUNT`.

### Bit offset maths

```
8 bits   = 1 byte   -> ceil(8/8)   = 1 byte
100 bits = 12.5 B   -> ceil(100/8) = 13 bytes
1,000,000 bits      -> ceil(1e6/8) = 125000 bytes = 122 KB
SETBIT 99 -> STRLEN 13 bytes (bit 99 is in byte 12)
```

Verified: `SETBIT off 99 1` produced a **13-byte** string. The rule is
`bytes = ceil(maxOffset / 8) + 1`.

### ⚠️ `BITCOUNT` is O(N/8), not O(1)

```
bitmap of 1,000,000 bits with 250,000 set
  bytes  -> 125000
  BITCOUNT -> 250000 in 0.14ms
```

0.14 ms is fast, but Redis **walked all 125,000 bytes**. Scale that to a billion bits and
you have a real stall. `BITCOUNT` is cheap at typical analytics sizes and genuinely slow at
extreme ones.

---

## 5. When to use it and when NOT to

### ✅ Use `BITOP` when

- **Overlapping populations**: daily/monthly active users.
- **Cohort analysis**: users active in week 1 AND still active in week 8.
- **Funnels**: signed up AND completed onboarding AND purchased.
- **Feature-gate analysis**: which users got flag A but not flag B?
- You want set maths across **millions** of entities in one command.

### ❌ Don't use it when

| Situation | Why | Use instead |
|---|---|---|
| IDs are sparse or huge | The bitmap explodes in size | [Set](09-sets.md) |
| You need the **member list**, not just a count | Bitmaps give you bits | `SCAN` the set |
| Inputs are **huge** | `BITOP` allocates a destination the size of the largest input | Filter first |
| You need to know **who**, only in a tiny range | Overkill | [Sets](09-sets.md) |
| Bitmaps must be **merged across cluster shards** | `BITOP` is single-key-ish | Hash tags ([Ch. 25](25-cluster.md)) |

### `BITOP NOT` is a trap

`NOT` produces a bitmap with **every** bit in the source's length flipped to 1. For a
realistic bitmap that is "every possible user", which is almost never what you want.

Use `NOT` **only as an input** to `AND`:

```
BITOP AND absent_tue nottue day1
```

---

## 6. Common mistakes

**Mistake 1 — Treating `BITOP NOT` as set difference.**
`NOT` is not "A minus B". Chain it: `BITOP AND dest srcA notB`.

**Mistake 2 — `BITCOUNT notX` and being surprised.**
Every 0 becomes 1, so the count is large. Expected behaviour.

**Mistake 3 — Forgetting `BITOP` returns a byte count, not a member count.**
`(integer) 1` means "the destination is 1 byte long". Use `BITCOUNT` for counts.

**Mistake 4 — Running `BITOP` on enormous bitmaps repeatedly.**
Each call allocates and walks memory. For very large populations, aggregate less often.

**Mistake 5 — Assuming `AND` of two days gives "all days".**
You need one `AND` across **all** the day keys, not pairwise. Chaining pairwise is correct
but O(days) commands.

**Mistake 6 — No TTLs on daily bitmaps.**
Without `EXPIRE`, last year's bitmaps stay forever. Give each day key a TTL of ~35 days.

**Mistake 7 — Using `sendCommand` incorrectly.** Arguments must all be **strings** or
numbers; a stray object throws `must be of type string`.

**Mistake 8 — Forgetting bitmaps do not shrink.**
`BITOP AND` to a small result still allocates to the **largest source's** length. Memory is
based on the source size.

---

## 7. Try it yourself

**Exercise:** With the 5-day bitmaps from the example, compute (1) users active on **every**
day, and (2) users active on Monday but not on Friday. Then compare the cost with the
equivalent set-based approach using `SINTER` on `SADD`-built sets.

**Hint:** (1) is one `BITOP AND` with all five keys. (2) is `BITOP NOT notfri fri` then
`BITOP AND answer mon notfri`. For the set version, build a set per day with `SADD` and use
`sInter`/`sDiff`.

**What to notice:** the `BITOP` version is 2 commands and O(bytes). The set version is 2
commands too, but each set stores full member strings, so memory grows with
`days × active users × ~50 bytes` instead of `days × maxUserId / 8`.

---

## 8. Next

**[Chapter 12 — HyperLogLog and Bloom filters](12-hyperloglog-and-bloom.md)** — two more
approximate structures, both trading a little accuracy for an enormous memory saving.

---

**Verified facts recap**

| Claim | How verified |
|---|---|
| `AND` of day1+day2 = users 2,3 | `BITCOUNT` → 2 |
| `XOR` gives exactly-one-day users | `110010` → 0,1,4 |
| `NOT` inverts every bit | `000011` for first 6 bits |
| `BITOP` returns **byte length** | `(integer) 1` |
| 5 days → 103 events, **44 unique** | `BITOP OR` + `BITCOUNT` |
| `SETBIT 99` → 13 bytes | `STRLEN` |
| 1,000,000 bits → 125,000 bytes | `STRLEN` |
| `BITCOUNT` of 1M bits = **0.14 ms** | Measured |
| `BITPOS` searches forward only | `bitPos(k,1,-1)` → 0 |
| Chaining `NOT` + `AND` = set difference | Verified |