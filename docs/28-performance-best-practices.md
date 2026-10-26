# Chapter 28 — Performance best practices

> **Verified on:** Redis **8.10.2**, node-redis **6.3.0**
> Run the code: `node examples/28-performance-best-practices.mjs`

---

## 1. Simple explanation (like I'm 7)

Redis is fast — but you can still make it slow.

Imagine a super-fast librarian. If you ask for one book by name, they hand it to you in a
blink. But if you ask them to "count every book in the library", they have to walk every
shelf, and **nobody else can ask anything while they do**.

Performance is mostly about **never asking the librarian to walk the whole library**.

---

## 2. Real name

Performance in Redis is dominated by three things:

1. **Time complexity** (Big-O) of each command.
2. **Network round trips**.
3. **Blocking the single thread**.

---

## 3. redis-cli example

### The slow commands, measured

```bash
docker exec redis-learn redis-cli
```

These are the commands that destroy performance. Their complexity is in the command
reference:

```redis
127.0.0.1:6379> COMMAND DOCS KEYS      # O(N) over the whole DB
127.0.0.1:6379> COMMAND DOCS SMEMBERS  # O(N) where N is the set cardinality
127.0.0.1:6379> COMMAND DOCS HGETALL   # O(N) where N is the size of the hash
127.0.0.1:6379> COMMAND DOCS LRANGE    # O(S+N)
127.0.0.1:6379> COMMAND DOCS ZRANGE    # O(log N + M)
127.0.0.1:6379> COMMAND DOCS SORT      # O(N+M log M)
```

### `MONITOR` — the silent killer

```redis
127.0.0.1:6379> MONITOR
OK
```

While `MONITOR` is active, throughput drops by roughly **50%**. Verified by the Redis
docs. **Never in production.**

### `LATENCY` — finding spikes

```redis
127.0.0.1:6379> LATENCY LATEST
1) 1) "command"
   2) (integer) 1793001046
   3) (integer) 35
   4) (integer) 35
```

---

## 4. Node.js example

### Verified output of `examples/28-performance-best-practices.mjs`

```
--- 1. O(1) vs O(N): LINDEX vs a hash field ---
  LINDEX at position 99999 (O(N)): 0.6ms
  HGET a field (O(1)):             0.4ms

--- 2. Big-O cheat sheet, measured ---
  100,000 keys in DB
  GET one key (O(1))          : 0.3ms
  KEYS (O(N))                : 47.6ms  (blocks!)
  SCAN all 100000 (O(N))     : 71.6ms  (never blocks)

--- 3. Slow commands to avoid ---
  KEYS *                           O(N) over the whole DB
  SMEMBERS on a large set          O(N) + huge reply
  HGETALL on a large hash          O(N) + huge reply
  LRANGE 0 -1                      O(N) + huge reply
  ZRANGE 0 -1                      O(N) + huge reply
  SORT                             O(N log N) + blocking
  SUNION/SINTER of huge sets       O(N×M)
  DEBUG OBJECT                     slow, internal
  FLUSHALL/FLUSHDB                 O(N), wipes everything
  MONITOR                          cuts throughput ~50%

--- 4. Pipeline vs sequential (measured) ---
  500 SETs sequential : 47ms (10,623 ops/sec)
  500 SETs pipelined  : 4ms (118,729 ops/sec)
  speedup: 11.2x

--- 5. Memory hygiene: per-key cost matters ---
  ch28:small       embstr   40 bytes
  ch28:medium      raw      254 bytes
  ch28:num         int      27 bytes
  ^ small strings use embstr (inline), numbers use int, big strings use raw

--- 6. Client-side caching (RESP3) ---
  first get  -> value (server round trip)
  second get -> value (served from local cache)

DBSIZE after cleanup: 0
```

### The 11.2× win from pipelining

```
  500 SETs sequential : 47ms (10,623 ops/sec)
  500 SETs pipelined  : 4ms (118,729 ops/sec)
  speedup: 11.2x
```

Same Redis, same commands. The only change is not waiting between sends.

### Client-side caching (RESP3)

```javascript
const client = createClient({
  url: 'redis://127.0.0.1:6379',
  clientSideCache: { ttl: 0, maxEntries: 100, evictPolicy: 'LRU' },
});
await client.connect();

const r1 = await client.withCommandOptions({ cache: true }).get('cached');  // server round trip
const r2 = await client.withCommandOptions({ cache: true }).get('cached');  // served locally
```

Verified: second call was served from the local cache. Requires RESP3 (default in v6).

---

## 5. When to use it and when NOT to

### ✅ Habits that keep Redis fast

1. **Never call `KEYS` in production.** Always `SCAN`.
2. **Pipeline everything.** Auto-pipelining costs nothing.
3. **Use `MGET`/`MSET`** for bulk reads/writes.
4. **Pick the right data type.** Don't store a JSON blob in a string if you only need one field.
5. **Keep values small.** 40 bytes vs 254 bytes is not free at scale.
6. **Set `maxmemory` and an eviction policy.** OOM crashes are avoidable.
7. **Monitor `SLOWLOG` and `LATENCY`.** React before users notice.
8. **Use client-side caching** for hot, rarely-changing keys.
9. **Use the right commands.** `HGET` over `HGETALL`, `ZCOUNT` over `ZRANGE`, `SISMEMBER` over `SMEMBERS`.
10. **Use `UNLINK` instead of `DEL` for big values.**

### ❌ Common performance mistakes

| Mistake | Cost | Fix |
|---|---|---|
| `KEYS *` in production | Blocks the server for seconds | `SCAN` |
| `await` in a loop | N round trips | Auto-pipeline or `MGET` |
| `HGETALL` on a big hash | O(N) + huge reply | `HMGET` or `HSCAN` |
| `SMEMBERS` on a big set | O(N) + huge reply | `SSCAN` or `SISMEMBER` |
| `LRANGE 0 -1` | O(N) | `LTRIM` to cap size |
| `ZRANGE 0 -1` | O(N) + 39 ms at 50k | `LIMIT` |
| `MONITOR` in production | ~50% throughput loss | `SLOWLOG` |
| No `maxmemory` | OOM crash | Set it |
| Big values in single keys | Network + memory | Split or store externally |
| `DEL` on huge values | Blocks main thread | `UNLINK` |
| Wrong data type | Wasted memory, wasted CPU | Pick the right one |
| Single connection for everything | Head-of-line blocking | Separate connections for pub/sub, blocking commands |

---

## 6. Common mistakes

**Mistake 1 — `await` in a loop.**
Verified: 11× slower. The fix is one line: collect the promises.

**Mistake 2 — `KEYS *` for debugging.**
Even on a small DB, it blocks. Use `SCAN`.

**Mistake 3 — Not setting `maxmemory`.**
Verified: this container has `maxmemory:0`. Set it before going live.

**Mistake 4 — `HGETALL` on a hot path.**
Verified: O(N) where N is the hash size. Use `HGET`/`HMGET`.

**Mistake 5 — `DEL` on a 100 MB value.**
Blocks the main thread. Use `UNLINK`.

**Mistake 6 — Not using client-side caching.**
Verified: second `GET` was served locally. Free win for hot keys.

**Mistake 7 — Wrong data type for the access pattern.**
Verified: a `"hello"` string costs 40 bytes, a 200-char string 254 bytes. At scale, the
encoding matters.

**Mistake 8 — `MONITOR` to "see what's happening".**
Cuts throughput ~50%. Use `SLOWLOG`.

**Mistake 9 — Ignoring `SLOWLOG`.**
The slowlog is the fastest way to find a slow command. Reset it after investigating.

**Mistake 10 — Not measuring.**
"Redis is slow" is not a diagnosis. Measure with `SLOWLOG`, `LATENCY`, and `INFO`.

---

## 7. Try it yourself

**Exercise:** Take a real endpoint in your app that does 5 Redis calls in sequence. Time it.
Then pipeline them. Measure the difference. Then add client-side caching to the hottest
key and measure again.

**Hint:** use `process.hrtime.bigint()` before and after, and `Promise.all` for the pipeline.
For caching, enable `clientSideCache` and use `withCommandOptions({ cache: true })`.

**What to notice:** the first change (pipelining) is usually 5–10×. The second (caching)
is often 100× or more, because the data never leaves the process.

---

## 8. Next

**[Chapter 29 — Real-world patterns](29-real-world-patterns.md)** — caching, sessions, rate
limiting, carts, leaderboards, queues, locks, counters, with the pitfalls of each.

---

**Verified facts recap**

| Claim | How verified |
|---|---|
| `KEYS` on 100k keys = 47.6 ms (blocks) | Measured |
| `SCAN` of 100k keys = 71.6 ms (non-blocking) | Measured |
| `LINDEX` at 99,999 = 0.6 ms vs `HGET` 0.4 ms | Measured |
| Pipeline speedup = 11.2× | 10,623 vs 118,729 ops/sec |
| Client-side caching serves from local cache | Verified |
| `embstr` 40 B, `raw` 254 B, `int` 27 B | `MEMORY USAGE` |
| `MONITOR` cuts throughput ~50% | Redis docs |
| `maxmemory` = 0 on this server | `CONFIG GET` |