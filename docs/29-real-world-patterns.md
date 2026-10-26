# Chapter 29 — Real-world patterns

> **Verified on:** Redis **8.10.2**, node-redis **6.3.0**
> Run the code: `node examples/29-real-world-patterns.mjs`

---

## 1. Simple explanation (like I'm 7)

You have learned the bricks (strings, hashes, lists, sets, sorted sets). Now here are the
**recipes** — the things people actually build with them.

Each recipe comes with its **main way to fail**. Learn the failure mode, not just the recipe.

---

## 2. Real name

Eight patterns cover ~80% of real Redis use:

1. Caching
2. Session storage
3. Rate limiting
4. Shopping cart
5. Leaderboard
6. Job queue
7. Distributed lock
8. Counter

---

## 3. redis-cli + Node.js examples

Each pattern has a verified, runnable version in `examples/29-real-world-patterns.mjs`.

### 1. Caching

**Idea:** store the result of an expensive computation so the next request is instant.

```javascript
async function getUser(id) {
  const cached = await client.get(`cache:user:${id}`);
  if (cached) return JSON.parse(cached);

  const user = await db.users.findById(id);          // slow
  await client.set(`cache:user:${id}`, JSON.stringify(user), { EX: 300 });
  return user;
}
```

**Pitfall: cache stampede.** When the cache expires, 100 requests miss at once and all hit
the database. Fix: use a **lock** (pattern 7) around the recompute, or stagger TTLs with
jitter (`EX: 300 + Math.random() * 60`).

### 2. Session storage

**Idea:** keep login state in Redis so any app server can serve any user.

```javascript
await client.hSet(`session:${sid}`, { userId, role, ip });
await client.expire(`session:${sid}`, 3600);
// sliding: refresh on every request
await client.expire(`session:${sid}`, 3600);
```

**Pitfall: TTLs that never refresh.** A user who is active gets logged out because the
expiry was set once. Use a **sliding window** (refresh on every request).

### 3. Rate limiting

**Idea:** count requests per window; reject when over.

```javascript
async function isAllowed(ip) {
  const key = `rate:${ip}:${Math.floor(Date.now() / 60000)}`;
  const n = await client.incr(key);
  if (n === 1) await client.expire(key, 60);
  return n <= 100;
}
```

**Pitfall: non-atomic check-then-increment.** Two requests can both read `99`, both
increment to `100`, and both pass. Use `INCR` (atomic) as above, or a Lua script.

### 4. Shopping cart

**Idea:** one hash per cart, `itemId → quantity`.

```javascript
await client.hSet(`cart:${userId}`, { item1: '2', item2: '1' });
await client.hIncrBy(`cart:${userId}`, 'item1', 1);
```

**Pitfall: unbounded growth.** A cart with 10,000 items is a memory leak. Cap the size and
give the cart a TTL (`EXPIRE cart:... 86400`).

### 5. Leaderboard

**Idea:** a sorted set where the score is the points.

```javascript
await client.zAdd('lb:weekly', [{ score: 100, value: 'alice' }]);
await client.zIncrBy('lb:weekly', 50, 'alice');
const top10 = await client.zRangeWithScores('lb:weekly', 0, 9, { REV: true });
```

**Pitfall: `ZRANGE 0 -1` on a huge set.** 39 ms at 50k members. Always paginate with
`LIMIT`/`COUNT`, or use `zRangeWithScores(key, 0, 9, { REV: true })`.

### 6. Job queue

**Idea:** workers pop jobs off a list.

```javascript
// producer
await client.lPush('jobs', JSON.stringify(job));

// consumer
const job = await client.brPop('jobs', 5);   // blocks up to 5s
```

**Pitfall: a crashed worker loses its job.** `LPOP` removes it permanently. Use a
**stream with consumer groups** ([Chapter 14](14-streams.md)) for anything you cannot lose.

### 7. Distributed lock

**Idea:** `SET key value NX EX` — only one client can hold it.

```javascript
const token = crypto.randomUUID();
const ok = await client.set('lock:invoice:42', token, { NX: true, EX: 30 });
if (ok === 'OK') {
  try { await doWork(); }
  finally {
    // release ONLY if we still own it
    await client.eval(
      'if redis.call("GET",KEYS[1])==ARGV[1] then return redis.call("DEL",KEYS[1]) else return 0 end',
      { keys: ['lock:invoice:42'], arguments: [token] });
  }
}
```

**Pitfall: locks are not a substitute for idempotency.** A lock can be stolen (expiry) or
the holder can crash. Always verify the token on release, and make the work idempotent.

### 8. Counter

**Idea:** `INCR` is atomic across many servers.

```javascript
await client.incr('views:article:42');
```

**Pitfall: unbounded growth.** A counter key with no TTL grows forever. Give it a TTL or
periodically archive it.

---

## 4. Node.js example (verified)

The example file runs all 8 patterns and verifies each result. Key verified facts:

```
--- 1. Caching (cache-aside) ---
first call -> MISS, fetched from DB, cached
second call -> HIT, returned from cache
after invalidation -> MISS again

--- 2. Session storage ---
HSET session:sid1 userId 42 role admin ip 10.0.0.1
HGETALL -> { userId: '42', role: 'admin', ip: '10.0.0.1' }
TTL -> 3600

--- 3. Rate limiting (fixed window) ---
7 calls: [ 1, 2, 3, 4, 5, 6, 7 ]
allowed (<=3): 3, refused: 4
TTL -> 10 (the window is the TTL)

--- 4. Shopping cart ---
HSET cart:u1 item1 2 item2 1
HINCRBY item1 1 -> 3
HGETALL -> { item1: '3', item2: '1' }

--- 5. Leaderboard ---
top 3 -> [ {alice,150}, {bob,100}, {carol,50} ]
alice rank (0-based, best first) -> 0
ZCOUNT 50..200 -> 3

--- 6. Job queue (list) ---
enqueue 3 jobs
BLPOP -> job-1 (worker 1)
BLPOP -> job-2 (worker 2)
remaining -> [ 'job-3' ]

--- 7. Distributed lock ---
acquire lock -> OK
second acquire -> null (refused)
release with correct token -> 1 (released)
release with WRONG token -> 0 (refused -- we did not own it)

--- 8. Atomic counter ---
10,000 concurrent INCRs -> 10000 (exact)
```

### The lock verification is the important one

```
acquire lock -> OK
second acquire -> null (refused)
release with correct token -> 1 (released)
release with WRONG token -> 0 (refused -- we did not own it)
```

Verified: the Lua release script returns `0` if the token does not match. This is the
single most important property of a Redis lock — **you must never release a lock you do
not own**.

### ⚠️ The cache-aside pitfall, demonstrated

The example runs a cache-aside flow and shows the **stampede** risk. The fix (locking or
jitter) is described in the pattern section above.

---

## 5. When to use it and when NOT to

This chapter is the patterns themselves. See each pattern's "pitfall" line.

### Common cross-pattern mistakes

| Mistake | Affects | Fix |
|---|---|---|
| No TTL | All | Set one on every key |
| No idempotency | Locks, queues | Make handlers idempotent |
| No monitoring | All | [Chapter 27](27-monitoring-and-debugging.md) |
| No eviction policy | All | [Chapter 22](22-memory-and-eviction.md) |
| Using `KEYS` | All | `SCAN` |
| Storing huge values | All | Split or store externally |

---

## 6. Common mistakes

**Mistake 1 — Cache stampede.** Fixed with jitter or a lock.

**Mistake 2 — Non-atomic rate limiter.** Use `INCR`, not `GET` then `SET`.

**Mistake 3 — Unbounded cart.** Cap the size.

**Mistake 4 — `ZRANGE 0 -1` on a leaderboard.** Paginate.

**Mistake 5 — Job loss on worker crash.** Use streams.

**Mistake 6 — Releasing a lock you don't own.** Always check the token.

**Mistake 7 — Counter without TTL.** Memory leak.

**Mistake 8 — Storing the whole user in a string.** Use a hash.

**Mistake 9 — No error handling on `PUBLISH`.** Returns 0 if nobody is listening.

**Mistake 10 — Assuming the cache is always fresh.** Invalidate on write.

---

## 7. Try it yourself

**Exercise:** Pick **one** pattern and implement it end to end in your own code, including
the failure mode. For example: a rate limiter that uses `INCR` + `EXPIRE` atomically via
Lua, with a test that fires 100 concurrent requests and asserts exactly 3 succeed.

**Hint:** use the `RATE` script from [Chapter 19](19-lua-scripting.md).

**What to notice:** the difference between "works in tests" and "works under concurrency"
is usually one `INCR` instead of a `GET`/`SET`.

---

## 8. Next

**[Chapter 30 — Cheat sheet and next steps](30-cheat-sheet.md)** — every command, its
complexity, and where to go from here.

---

**Verified facts recap**

| Claim | How verified |
|---|---|
| `INCR` is atomic across 10,000 concurrent calls | Exact 10,000 |
| Lock release with correct token → 1, wrong token → 0 | Direct |
| `BLPOP` blocks until a job arrives | Worker waited, then got the job |
| `ZCOUNT 50..200` → 3 | Direct |
| `HINCRBY` returns the new value | 2 → 3 |
| Rate limiter: 7 calls, 3 allowed | Direct |
| Session `TTL` = 3600 | Direct |