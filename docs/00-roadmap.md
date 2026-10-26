# Redis Learning Roadmap — Beginner to Advanced

> **Every example in this guide was executed against the exact setup below before being written down.
> If a chapter and the running server ever disagree, the running server wins.**

## Your setup (source of truth)

| Thing | Version / value | How it was confirmed |
|---|---|---|
| Redis server | **8.10.2** | `redis-server --version` → `Redis server v=8.10.2` |
| Redis mode | `standalone` | `INFO server` → `redis_mode:standalone` |
| Architecture | `x86_64` | `INFO server` → `arch_bits:64` |
| OS inside container | Linux 7.0.0-38 (Ubuntu 26.04 host) | `INFO server` |
| Total commands | **447** | `COMMAND COUNT` |
| Modules loaded | `ReJSON` (81000), `search` (81001), `bf` (81001), `timeseries` (81001), `vectorset` (1) | `MODULE LIST` |
| **JSON + Search available?** | **Yes** — both loaded, so Chapters 12–13 are real, not theory | `MODULE LIST` |
| node-redis client | **6.3.0** | `require('redis/package.json').version` |
| Node.js | v24.19.0 | `node --version` |
| Wire protocol | **RESP3** (default in node-redis 6) | `CLIENT INFO` → `resp=3` |
| Persistence defaults | AOF **off**, RDB **on** | `INFO persistence` → `aof_enabled:0` |
| Auth default | None (user `default`, no password) | `ACL WHOAMI` → `default`, `ACL LIST` |

### Notes where the docs and this setup disagree

These are the real, verified differences. They are respected throughout the guide.

1. **`client.pipeline()` no longer exists in node-redis 6.** It was removed. Modern replacement: `client.multi().execAsPipeline()`. (Verified: `typeof client.pipeline === 'undefined'`.)
2. **`QUIT` is deprecated** (server marks it `deprecated_since 7.2.0`). Use `client.close()`, not `client.quit()`. `disconnect()` was renamed `destroy()`.
3. **Multi-element list/set/geo commands need an array in v6**, e.g. `rPush(key, ['a','b'])`. Varargs like `rPush(key,'a','b')` **silently drop** everything after the first element. This is a nasty trap and is documented in full in Ch. 08/09.
4. **`WATCH` is a top-level client command in v6**, not chained off `multi()`. A failed watch throws `WatchError`.
5. **Module commands need a `modules:` option.** The core client has no `c.json`, `c.ft`, or `c.bf`. `sendCommand(['JSON.SET',...])` always works, and is used where it is clearer.
6. `geoSearch` in the v6 client only takes `SORT`/`COUNT` options — for `WITHDIST`/`WITHCOORD` you must use `sendCommand`.
7. `hTTL` / `hpTTL` / `renameNX` have unusual capitalisation in the JS client.
8. Method-casing trap: `slowlogLen`, `dbSize` etc. are **not** on the client prototype — several "obvious" helpers only exist via `sendCommand`.
9. **`scanIterator` / `hScanIterator` / `sScanIterator` / `zScanIterator` yield a BATCH (array) per round trip**, not one item. Destructuring as a single key silently miscounts.
10. **`hTTL`/`hExpire` take a fields array; the client inserts `FIELDS n` itself.** Passing `'FIELDS','1',field` manually returns a wrong `-2` instead of erroring.
11. **`hExpire(key, fields, seconds)` shares ONE seconds value across all fields** — per-field TTLs need separate calls.
12. **`hScan(key, cursor, opts)` takes the key first**, unlike `scan(cursor, opts)`.
13. `hash-max-listpack-entries` is **512** in 8.10 (not the 128 seen in older docs); conversion to `hashtable` triggers at field **513**.
14. `list-max-listpack-size` is **-2** (unlimited) in Redis 8 — lists never switch to quicklist by default.
15. **`bitCount(key, start, end)` is ignored.** The range must be an object: `bitCount(key, { start, end })`.
16. **`BF.EXISTS` returns a boolean** under RESP3 (`true`/`false`), not `1`/`0`.
17. `BF.ADD` takes **one** item per call (RedisBloom 81001).
18. Many commands that look like they take `(key, count)` actually take `(key)` only — use the `_COUNT` / `_WithScores` variants (`sPopCount`, `sRandMemberCount`, `zPopMinCount`, `zUnionWithScores`).
19. Method-name casing is irregular: `blPop`, `brPop`, `lmPop`, `zmScore`, `smIsMember`, `hTTL`, `hpTTL`, `renameNX`.
20. **`bitCount(key, start, end)` is ignored** — the range must be an object: `bitCount(key, { start, end })`.
21. **`BF.EXISTS` returns a boolean** under RESP3 (`true`/`false`), not `1`/`0`. Comparing with `=== 1` reports 0% false positives forever.
22. `BF.ADD` takes **one** item per call.
23. Module clients need **double** `.default` unwrapping in ESM: `(await import('@redis/json')).default.default`.
24. **`json.get(key, path)` silently ignores a positional path** — use `json.get(key, { path })`.
25. **`ft.search` `SORTBY` is `{ BY, DIRECTION }`** — a wrong key like `SORTBY_ORDER` is silently ignored, so DESC and ASC both return relevance order.
26. RediSearch boolean OR is the pipe character `|`, **not** the word `OR`.
27. `XINFO GROUPS` returns **hyphenated** field names under RESP3 (`last-delivered-id`).

---

## How to read this guide

Each chapter always has these 8 sections, in this order:

1. **Simple explanation (like I'm 7)** — no jargon, with an analogy
2. **Real name** — the technical term, defined
3. **redis-cli example** — the commands + the exact output
4. **Node.js example** — complete, runnable, commented
5. **When to use it and when NOT to** — trade-offs
6. **Common mistakes** — what beginners get wrong
7. **Try it yourself** — one small exercise + hint
8. **Next** — link forward

Chapter `NN` has a runnable companion file at `examples/NN-slug.mjs`. Run one with:

```bash
node examples/03-keys-and-naming.mjs
```

Run `redis-cli` inside Docker with:

```bash
docker exec -it redis-learn redis-cli
```

---

## Part 0 — Setup and orientation

| # | Chapter | Covers | Status |
|---|---|---|---|
| 01 | [What is Redis?](01-what-is-redis.md) | What it is, why it's fast, in-memory vs disk, where it fits | ✅ done |
| 02 | [Install and redis-cli](02-install-and-redis-cli.md) | Docker setup, redis-cli tour, connect/inspect server | ✅ done |
| 03 | [Connect from Node.js](03-nodejs-client-setup.md) | node-redis 6 setup, events, `close()` vs `quit()`, raw commands | ✅ done |

## Part 1 — Core building blocks

| # | Chapter | Covers | Status |
|---|---|---|---|
| 04 | [Keys and naming](04-keys-and-naming.md) | Key rules, naming conventions, `KEYS` vs `SCAN`, `TYPE`, `DEL`/`UNLINK`, `EXISTS` | ✅ done |
| 05 | [Strings](05-strings.md) | `SET`/`GET`, `SETEX`, counters, `INCR`, binary safety | ✅ done |
| 06 | [Expiration and TTL](06-expiration-and-ttl.md) | `EXPIRE`/`TTL`/`PTTL`, `PERSIST`, expiry policies, key eviction | ✅ done |
| 07 | [Hashes](07-hashes.md) | `HSET`/`HGET`/`HGETALL`, field-level TTL, when not to use | ✅ done |

## Part 2 — Collections

| # | Chapter | Covers | Status |
|---|---|---|---|
| 08 | [Lists](08-lists.md) | `LPUSH`/`RPUSH`/`LPOP`/`RPOP`, ranges, blocking ops, queues | ✅ done |
| 09 | [Sets](09-sets.md) | `SADD`/`SISMEMBER`, set algebra, `SMEMBERS` cost | ✅ done |
| 10 | [Sorted sets](10-sorted-sets.md) | Scores, `ZRANGE`/`ZREVRANGE`, `ZRANGEBYSCORE`, `ZRANK`, leaderboards | ✅ done |

## Part 3 — Specialised data types

| # | Chapter | Covers | Status |
|---|---|---|---|
| 11a | [Bitmaps and bitfields (part 1)](11a-bitmaps.md) | Bits, `SETBIT`/`GETBIT`, `BITCOUNT`, `BITFIELD`, overflow modes | ✅ done |
| 11b | [Bitmaps (part 2)](11b-bitmaps-analytics.md) | `BITOP`, weekly-unique analytics, memory math | ✅ done |
| 12 | [HyperLogLog and Bloom filters](12-hyperloglog-and-bloom.md) | Approximate counting, `PFADD`/`PFCOUNT`, `BF.*` false positives | ✅ done |
| 13 | [Geospatial indexes](13-geospatial.md) | `GEOADD`, `GEOSEARCH`, `GEODIST`, the 52-bit precision trap | ✅ done |
| 14 | [Streams](14-streams.md) | `XADD`/`XREAD`, consumer groups, `XACK`, `XAUTOCLAIM`, trimming | ✅ done |
| 15 | [RedisJSON](15-json.md) | `JSON.SET`/`GET`, JSONPath, partial updates | ✅ done |
| 16 | [Search and querying](16-search.md) | `FT.CREATE`, `FT.SEARCH`, index design, HASH vs JSON | ✅ done |

## Part 4 — Working with many commands

| # | Chapter | Covers | Status |
|---|---|---|---|
| 17 | [Transactions (MULTI/EXEC)](17-transactions.md) | Atomicity, no-rollback, `WATCH`, `errorIndexes` | ✅ done |
| 18 | [Pipelining](18-pipelining.md) | Round-trip saving, `execAsPipeline`, auto-pipelining | ✅ done |
| 19 | [Lua scripting](19-lua-scripting.md) | `EVAL`, `EVALSHA`, `SCRIPT LOAD`, why scripts block | ✅ done |
| 20 | [Pub/Sub](20-pub-sub.md) | `PUBLISH`/`SUBSCRIBE`, channels, the "messages vanish" trap | ✅ done |

## Part 5 — Running Redis for real

| # | Chapter | Covers | Status |
|---|---|---|---|
| 21 | [Persistence: RDB and AOF](21-persistence.md) | Snapshots, append-only log, trade-offs, what's on by default here | ✅ done |
| 22 | [Memory and eviction](22-memory-and-eviction.md) | `maxmemory`, the 8 policies, `MEMORY USAGE` | ✅ done |
| 23 | [Replication](23-replication.md) | Primary/replica, `REPLICAOF`, read scaling, async lag | ✅ done |
| 24 | [Sentinel](24-sentinel.md) | Automatic failover, monitoring, trade-offs | ✅ done |
| 25 | [Cluster](25-cluster.md) | Hash slots, 16384 slots, MOVED/ASK, when you need it | ✅ done |
| 26 | [Security](26-security.md) | ACLs, passwords, TLS, the "Redis is on a private network" myth | ✅ done |

## Part 6 — Being a good operator

| # | Chapter | Covers | Status |
|---|---|---|---|
| 27 | [Monitoring and debugging](27-monitoring-and-debugging.md) | `INFO`, `SLOWLOG`, `LATENCY`, `CLIENT LIST`, `OBJECT` | ✅ done |
| 28 | [Performance best practices](28-performance-best-practices.md) | Slow commands, `SCAN` discipline, pipelining, memory hygiene | ✅ done |
| 29 | [Real-world patterns](29-real-world-patterns.md) | The 8 patterns, end to end, with pitfalls | ✅ done |
| 30 | [Cheat sheet and next steps](30-cheat-sheet.md) | Command reference, big-o table, where to go next | ✅ done |

---

## Real-world patterns (detailed in Ch. 29)

| Pattern | Data type used | One-line idea | The main pitfall |
|---|---|---|---|
| **Caching** | String (usually JSON) | Keep the answer so you don't ask the slow database | Cache stampede — 100 requests miss at once and all hit the DB |
| **Session storage** | String / Hash | Keep login state outside your app servers | Logged-out users still hold a TTL'd session; need cleanup |
| **Rate limiting** | String counter + TTL | Count requests per window, reject when over | Non-atomic `SET` then `INCR` leaks counters forever |
| **Shopping cart** | Hash | `itemId -> quantity`, whole cart in one key | Cart grows unboundedly; needs a max size and TTL |
| **Leaderboards** | Sorted set | Score = points, `ZREVRANGE` = top N | Very large sets make `ZRANGE` slow; page instead |
| **Job queues** | List / Streams | Workers pop jobs off a list | A crashed worker loses its job unless you use Streams + groups |
| **Distributed locks** | String + `SET NX EX` | "Only one of my 10 servers does this right now" | Locks are not a substitute for idempotency; always verify the token |
| **Counters** | String with `INCR` | Atomic add without read-modify-write | Unbounded growth on a counter key; no TTL = never freed |

---

## Progress checklist

Tick a box when its chapter is finished **and** you have run the code in it.

**Part 0 — Setup**
- [x] 01 What is Redis
- [x] 02 Install and redis-cli
- [x] 03 Connect from Node.js

**Part 1 — Building blocks**
- [x] 04 Keys and naming
- [x] 05 Strings
- [x] 06 Expiration and TTL
- [x] 07 Hashes

**Part 2 — Collections**
- [x] 08 Lists
- [x] 09 Sets
- [x] 10 Sorted sets

**Part 3 — Specialised types**
- [x] 11a Bitmaps part 1
- [x] 11b Bitmaps part 2
- [x] 12 HyperLogLog and Bloom
- [x] 13 Geospatial
- [x] 14 Streams
- [x] 15 JSON
- [x] 16 Search

**Part 4 — Many commands at once**
- [x] 17 Transactions
- [x] 18 Pipelining
- [x] 19 Lua scripting
- [x] 20 Pub/Sub

**Part 5 — Production**
- [x] 21 Persistence
- [x] 22 Memory and eviction
- [x] 23 Replication
- [x] 24 Sentinel
- [x] 25 Cluster
- [x] 26 Security

**Part 6 — Operations**
- [x] 27 Monitoring and debugging
- [x] 28 Performance best practices
- [x] 29 Real-world patterns
- [x] 30 Cheat sheet

---

## Planned delivery batches

I will write **3–5 chapters per batch**, then stop for your review.

| Batch | Chapters |
|---|---|
| 1 | 01, 02, 03, 04 |
| 2 | 05, 06, 07 |
| 3 | 08, 09, 10 |
| 2 | 04, 05, 06, 07 |
| 3 | 08, 09, 10 |
| 4 | 11a, 11b, 12 |
| 5 | 13, 14, 15, 16 |
| 6 | 17, 18, 19, 20 |
| 7 | 21, 22 |
| 8 | 23, 24, 25, 26 |
| 8 | 24, 25, 26 |
| 9 | 27, 28, 29, 30 |

---

## Sources

1. Official docs — <https://redis.io/docs/latest/develop/data-types/>
2. Command reference — <https://redis.io/docs/latest/commands/>
3. node-redis README + docs — <https://github.com/redis/node-redis>
4. **The running server** — `redis-cli` and `COMMAND DOCS`, verified per chapter

Where these disagree, chapter 1 (or the note above) says so explicitly.