# Chapter 08 — Lists

> **Verified on:** Redis **8.10.2**, node-redis **6.3.0**
> Run the code: `node examples/08-lists.mjs`

---

## 1. Simple explanation (like I'm 7)

A list is a **line of people waiting for a ride**.

- New people join the **back** (`RPUSH`).
- The person at the **front** gets picked up first (`LPOP`).
- Nobody is skipped and nobody serves twice.

That is a **queue**. If instead the person at the **back** gets picked up, you built a
**stack** — like a pile of plates where you always take the top one.

---

## 2. Real name

A **list** is an ordered collection of strings, ordered by **insertion**. Duplicates are
allowed. Indexes are 0-based, and **negative indexes count from the end** (`0` = first,
`-1` = last).

### Commands

| Command | Cost | What it does |
|---|---|---|
| `LPUSH key v [v...]` | O(1) each | Add to the **front** |
| `RPUSH key v [v...]` | O(1) each | Add to the **back** |
| `LPOP key [count]` | O(1) / O(N) | Remove from the **front** |
| `RPOP key [count]` | O(1) / O(N) | Remove from the **back** |
| `LLEN key` | **O(1)** | How many items |
| `LINDEX key i` | O(N) | Item at index i |
| `LRANGE key start stop` | O(S+N) | A slice of the list |
| `LINSERT key BEFORE\|AFTER pivot v` | O(N) | Insert next to a value |
| `LSET key i v` | O(N) | Replace item at index i |
| `LPOS key v` | O(N) | Index of the first match |
| `LREM key count v` | O(N+M) | Remove occurrences |
| `LTRIM key start stop` | O(N) | Cut the list down to a range |
| `LMOVE src dst LEFT RIGHT` | O(1) | Move between lists, atomically |
| `LMPOP numkeys key... LEFT\|RIGHT` | O(N+M) | Pop from the first non-empty list |
| `BLPOP key... timeout` | blocks | Pop, **waiting** for an item |

### Queue vs stack — which end

```
FIFO queue:  LPUSH (add)  +  RPOP (take)   → oldest first  ← job queues
LIFO stack:  LPUSH (add)  +  LPOP (take)   → newest first  ← undo stacks
```

### Redis 8 encoding note

Older docs say a list becomes a **quicklist** after 128 items. **Not in Redis 8.** Verified
on this server:

```
list-max-listpack-size : -2      (-2 = unlimited)
list-compress-depth    : 0       (compression off)
```

```
3 items  -> listpack (45 bytes)
303 items-> listpack (1735 bytes)
```

Lists are **always listpack-encoded by default** in 8.10.2. This is cheaper in memory than
the old quicklist of small nodes.

---

## 3. redis-cli example

```bash
docker exec -it redis-learn redis-cli
```

```redis
127.0.0.1:6379> RPUSH ch08:tasks write review ship
(integer) 3
127.0.0.1:6379> LRANGE ch08:tasks 0 -1
1) "write"
2) "review"
3) "ship"
127.0.0.1:6379> LLEN ch08:tasks
(integer) 3
127.0.0.1:6379> LPOP ch08:tasks
"write"
127.0.0.1:6379> RPOP ch08:tasks
"ship"
127.0.0.1:6379> LRANGE ch08:tasks 0 -1
1) "review"

127.0.0.1:6379> LINSERT ch08:tasks BEFORE review "urgent"
(integer) 2
127.0.0.1:6379> LRANGE ch08:tasks 0 -1
1) "urgent"
2) "review"
127.0.0.1:6379> LPOS ch08:tasks review
(integer) 1
127.0.0.1:6379> LSET ch08:tasks 99 "x"
(error) ERR index out of range
```

### Capped lists with `LTRIM`

```redis
127.0.0.1:6379> LLEN ch08:trim
(integer) 1000
127.0.0.1:6379> LTRIM ch08:trim 0 99
OK
127.0.0.1:6379> LLEN ch08:trim
(integer) 100
```

Keep the **newest** items by trimming with negative indexes: `LTRIM key -100 -1`.

### `LMOVE` — the safe way to build a worker queue

```redis
127.0.0.1:6379> RPUSH queue:pending job-a job-b
(integer) 2
127.0.0.1:6379> LMOVE queue:pending queue:active LEFT RIGHT
"job-a"
```

Atomic. A `LPOP` + `RPUSH` pair would lose the job if the process died between them.

---

## 4. Node.js example

### Verified output of `examples/08-lists.mjs`

```
--- basics ---
LLEN       -> 3
LRANGE 0 -1-> [ 'write', 'review', 'ship' ]
LINDEX 0   -> write
LPOP       -> write (from the left)
RPOP       -> ship (from the right)
remaining  -> [ 'review' ]

--- ⚠️ the varargs trap ---
rPush(key,'a','b','c') -> [ 'a' ]   ← "b" and "c" were SILENTLY DROPPED
rPush(key,['a','b','c']) ->
  -> [ 'a', 'b', 'c' ]   ✓ all three stored

--- editing ---
LINSERT BEFORE b -> 4
list             -> [ 'a', 'z', 'b', 'c' ]
LSET 0 X         -> OK
LPOS c           -> 4 (0-based index)
LPOS nope        -> null (null = not found)
LSET bad index   -> ERR index out of range

--- blocking pop (real queue behaviour) ---
BLPOP returned {"key":"ch08:work","element":"job-1"} after 302ms (it really waited)
BLPOP timeout -> null after 1024ms

--- LMOVE ---
LMOVE pending->active -> job-a
pending -> [ 'job-b' ]
active  -> [ 'job-a' ]

--- LMPOP ---
lmPop([m1,m2], LEFT, {COUNT:1}) -> [ 'ch08:m1', [ '1' ] ]

--- LTRIM ---
LLEN before -> 1000
LTRIM 0 99  -> OK
LLEN after  -> 100

--- encoding ---
list-max-listpack-size : -2 (-2 = unlimited)
list-compress-depth    : 0 (compression off)
3 items  -> listpack (45 bytes)
303 items-> listpack (1735 bytes)
  ^ still listpack. Older docs say 128 and a "quicklist" switch -- in Redis 8
    the default limit is -2 (unlimited), so there is no switch at all.

DBSIZE after cleanup: 0
```

### 🔴 TRAP — the varargs trap (this one loses data silently)

```javascript
await client.rPush('k', 'a', 'b', 'c');        // ✗ stores ONLY 'a'
await client.rPush('k', ['a', 'b', 'c']);      // ✓ stores all three
```

Verified:

```
rPush(key,'a','b','c') -> [ 'a' ]   ← "b" and "c" were SILENTLY DROPPED
rPush(key,['a','b','c']) -> [ 'a', 'b', 'c' ]   ✓
```

**No error is thrown.** JavaScript silently ignores extra function arguments, so this
fails completely invisibly. The same applies to `lPush`, `sAdd`, and `geoAdd`.

> In **redis-cli** and other clients (ioredis, redis-py), variadic works normally:
> `RPUSH k a b c` stores all three. This is a **node-redis 6** API difference.

### Blocking pops — real queue behaviour

```javascript
const worker = client.duplicate();       // ⚠️ dedicated connection
await worker.connect();

// This call WAITS instead of returning empty
const blocked = worker.blPop('work', 3); // 3 second timeout
await new Promise(r => setTimeout(r, 300));
await client.rPush('work', ['job-1']);

await blocked;   // { key: 'ch08:work', element: 'job-1' }  ← after ~302ms
```

Verified — it genuinely blocked, then returned as soon as the item arrived:

```
BLPOP returned {"key":"ch08:work","element":"job-1"} after 302ms (it really waited)
BLPOP timeout -> null after 1024ms
```

> ⚠️ The method is **`blPop`** (lowercase `l`), not `bLPop`.
> ⚠️ **Blocking commands need their own connection.** While `BLPOP` waits, that connection
> cannot run anything else. Using your main client for it will freeze all your app's Redis
> calls.

### Method names that trip people up

| What you want | Correct name | Common wrong guess |
|---|---|---|
| Blocking left pop | `blPop` | `bLPop` ❌ |
| Blocking right pop | `brPop` | `bRPop` ❌ |
| Multi-key pop | `lmPop` | `lMPop` ❌ |

`lmPop` takes a **keys array**:

```javascript
await client.lmPop(['listA', 'listB'], 'LEFT', { COUNT: 2 });
// → ['listA', ['1','2']]   the first non-empty list, and what was taken
```

---

## 5. When to use it and when NOT to

### ✅ Use a list when

- **Order matters** and you push/pop from the ends.
- Building a **FIFO job queue** (`LPUSH` + `RPOP`).
- Building a **LIFO stack** (`LPUSH` + `LPOP`).
- Keeping a **capped history** of the last N events with `LTRIM`.
- You want a consumer to **sleep** until work arrives (`BLPOP`).

### ❌ Don't use a list when

| Situation | Why | Use instead |
|---|---|---|
| You need random access by position often | `LINDEX`/`LSET` are O(N) | [Hash](07-hashes.md) or [string](05-strings.md) |
| You need membership tests | O(N) scan | [Set](09-sets.md) |
| You need ordering by **value** | Lists sort by insertion only | [Sorted set](10-sorted-sets.md) |
| **Multiple consumers** must each see every item | `LPOP` removes it — only one consumer gets it | [Streams](14-streams.md) with consumer groups |
| The list **grows forever** | Unbounded memory | `LTRIM`, a TTL, or a stream with trimming |
| You need to **acknowledge** work done | Lists have no ack | [Streams](14-streams.md) |

### 🔴 The single most important limitation

**A popped item is gone.** If your worker crashes after `LPOP` but before finishing the
work, **the job is lost forever**. Lists have no acknowledgement, no redelivery, and no
consumer groups.

That is fine for "send an email" if you accept occasional loss. It is **not** fine for
"process a payment". For anything you must not lose, use [Streams](14-streams.md) with a
consumer group and `XACK`.

---

## 6. Common mistakes

**Mistake 1 — The varargs trap.** `rPush(key, 'a','b','c')` silently stores only `'a'`.
Always pass an **array**.

**Mistake 2 — Using `LPOP` + `RPUSH` to move a job between lists.** Not atomic. Use
`LMOVE` (or `BRPOPLPUSH` for the blocking version).

**Mistake 3 — Blocking on your main connection.** `BLPOP` freezes that connection for the
whole wait. Use `client.duplicate()`.

**Mistake 4 — Forgetting that `LPOP` deletes the item.** No redelivery if the worker dies.

**Mistake 5 — `LRANGE 0 -1` on a huge list.** O(N) and a giant reply. Use `LTRIM` to cap
the size in the first place.

**Mistake 6 — Unbounded lists.** A list with no `LTRIM` and no TTL is a memory leak.

**Mistake 7 — Assuming `LPOS` returns -1 for missing.** In node-redis it returns **`null`**.
In redis-cli it shows `-1`.

**Mistake 8 — Using negative indexes incorrectly.** `-1` is the **last** element, `-2` the
second-to-last. `LRANGE 0 -10` on a 3-element list returns the whole list.

**Mistake 9 — Trusting the old quicklist documentation.** In Redis 8 lists stay listpack by
default (`list-max-listpack-size: -2`).

**Mistake 10 — Assuming `LPUSHX`/`RPUSHX` create the list.** They only push if the key
**already exists** — that's their whole purpose.

---

## 7. Try it yourself

**Exercise:** Build a real worker queue with three lists: `pending`, `active`, `done`. Write
`enqueue(job)`, `claim()` (uses `LMOVE pending → active`) and `complete(job)` (moves
`active → done`). Then simulate a worker crashing: claim a job, "crash" without completing,
and observe that the job is stuck in `active` forever.

**Hint:** `await client.lMove('pending', 'active', 'RIGHT', 'LEFT')` for the claim.
For the crash, just skip `complete()`. Then ask yourself: how would you know a job is stuck,
and how would you recover it?

**What to notice:** the job is neither lost nor duplicated — it's **stuck**. That is the
exact failure mode that Streams with consumer groups solve
([Chapter 14](14-streams.md)): `XAUTOCLAIM` hands abandoned jobs to another worker after a
timeout.

---

## 8. Next

**[Chapter 09 — Sets](09-sets.md)** — unordered unique collections, and the O(1)
membership test that makes them so fast.

---

**Verified facts recap**

| Claim | How verified |
|---|---|
| `rPush(key,'a','b','c')` drops `'b'`,`'c'` | `LRANGE` → `[ 'a' ]` |
| `rPush(key,['a','b','c'])` stores all 3 | `LRANGE` → `[ 'a','b','c' ]` |
| Method is `blPop`, not `bLPop` | `bLPop` is undefined |
| `BLPOP` genuinely blocks, then returns | 302 ms wait, got `job-1` |
| `BLPOP` returns `null` on timeout | After 1024 ms with a 1 s timeout |
| `LMOVE` is atomic between lists | `job-a` moved, both lists verified |
| `lmPop` takes a keys **array** | `[ 'ch08:m1', [ '1' ] ]` |
| `lPos` returns `null` when missing | Direct |
| `LTRIM 0 99` cuts 1000 → 100 | Direct |
| `list-max-listpack-size` = **-2** | `CONFIG GET` |
| 303-item list still `listpack` | `OBJECT ENCODING` |