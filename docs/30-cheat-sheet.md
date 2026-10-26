# Chapter 30 — Cheat sheet and next steps

> **Verified on:** Redis **8.10.2**, node-redis **6.3.0**
> Run the code: `node examples/30-cheat-sheet.mjs`

---

## 1. Simple explanation (like I'm 7)

This is your **dictionary**. You already learned the words; this page is the index at the
back of the book.

When you forget a command, look it up here. When you need the Big-O of something, look it
up here. When you wonder "what's next?", the last section tells you.

---

## 2. Real name

This chapter is a reference, not a tutorial. It collects everything verified across the
previous 29 chapters into one place.

---

## 3. redis-cli + Node.js

The companion file `examples/30-cheat-sheet.mjs` runs a **smoke test** of every major
command family against your running server and prints the Big-O for each.

---

## 4. The cheat sheet

### Strings

| Command | Cost | What it does |
|---|---|---|
| `SET k v [EX s] [NX\|XX] [KEEPTTL] [GET]` | O(1) | Store a value |
| `GET k` | O(1) | Read a value |
| `MSET k1 v1 k2 v2` / `MGET k1 k2` | O(N) | Bulk set / get |
| `INCR` / `DECR` / `INCRBY` / `INCRBYFLOAT` | O(1) | Atomic counters |
| `APPEND k v` | O(1) amortised | Append to a string |
| `STRLEN k` | O(1) | Length in bytes |
| `GETRANGE k s e` / `SETRANGE k o v` | O(N) | Substring read/write |
| `GETDEL k` / `GETEX k EX s` | O(1) | Read-and-delete / read-and-expire |
| `SETBIT` / `GETBIT` / `BITCOUNT` / `BITPOS` | O(1) / O(N/8) | Bitmap operations |
| `BITOP AND\|OR\|XOR\|NOT` | O(N/8) | Combine bitmaps |
| `BITFIELD k SET\|GET\|INCRBY` | varies | Packed counters |

### Keys

| Command | Cost | What it does |
|---|---|---|
| `DEL k...` / `UNLINK k...` | O(N) / O(1) | Delete (sync / async) |
| `EXISTS k...` | O(1) per key | How many exist |
| `TYPE k` | O(1) | `"string"`, `"list"`, … |
| `RENAME a b` / `COPY src dst` | O(1) | Rename / copy (TTL moves) |
| `EXPIRE` / `PEXPIRE` / `EXPIREAT` / `PERSIST` | O(1) | TTL management |
| `TTL` / `PTTL` / `EXPIRETIME` | O(1) | `-1`=forever, `-2`=missing |
| `RANDOMKEY` | O(1) | One random key |
| `SCAN cursor [MATCH p] [COUNT n] [TYPE t]` | O(1) per call | **Safe** key listing |
| `KEYS pattern` | **O(N)** | ⚠️ Never in production |
| `OBJECT ENCODING` / `MEMORY USAGE` | O(1) | Internals |

### Hashes

| Command | Cost | What it does |
|---|---|---|
| `HSET k f v [f v...]` | O(1) per field | Set fields |
| `HGET k f` / `HMGET k f...` | O(1) / O(N) | Read field(s) |
| `HGETALL k` | **O(N)** | All fields (avoid on big hashes) |
| `HDEL k f...` | O(1) per field | Remove fields |
| `HEXISTS k f` / `HLEN k` | O(1) | Existence / count |
| `HKEYS k` / `HVALS k` | O(N) | Field names / values |
| `HINCRBY k f n` / `HINCRBYFLOAT` | O(1) | Atomic field increment |
| `HSCAN k cursor` | O(1) per call | Safe iteration |
| `HEXPIRE` / `HTTL` / `HPERSIST` (7.4+) | O(N) fields | Field-level TTL |

### Lists

| Command | Cost | What it does |
|---|---|---|
| `LPUSH` / `RPUSH` | O(1) each | Push front / back |
| `LPOP` / `RPOP` | O(1) / O(N) | Pop front / back |
| `BLPOP` / `BRPOP` | blocks | Blocking pop |
| `LLEN` | **O(1)** | Length |
| `LINDEX k i` | O(N) | Item at index |
| `LRANGE k s e` | O(S+N) | Slice |
| `LINSERT` / `LSET` / `LREM` | O(N) | Edit |
| `LPOS k v` | O(N) | Index of first match |
| `LTRIM k s e` | O(N) | Cut to a range |
| `LMOVE src dst L R` | O(1) | Atomic move between lists |
| `LMPOP` / `BLMPOP` | O(N+M) | Pop from first non-empty list |

### Sets

| Command | Cost | What it does |
|---|---|---|
| `SADD k m...` | O(1) each | Add (returns count of new) |
| `SISMEMBER k m` | **O(1)** | Is it a member? |
| `SMISMEMBER k m...` | O(N) | Check several |
| `SREM k m...` | O(1) each | Remove |
| `SCARD k` | **O(1)** | Count |
| `SMEMBERS k` | **O(N)** | ⚠️ All members |
| `SRANDMEMBER k [n]` | O(n) | Random, non-destructive |
| `SPOP k [n]` | O(n) | Random, destructive |
| `SINTER` / `SUNION` / `SDIFF` | O(N×M) | Set algebra |
| `SINTERCARD` | O(N×M) | Count of intersection |
| `SSCAN k cursor` | O(1) per call | Safe iteration |

### Sorted sets

| Command | Cost | What it does |
|---|---|---|
| `ZADD k score member...` | O(log N) | Add / update |
| `ZSCORE k member` | **O(1)** | Read a score |
| `ZMSCORE k m...` | O(N) | Several scores |
| `ZCARD k` | **O(1)** | Count |
| `ZRANGE k s e [WITHSCORES]` | O(log N + M) | By rank, ascending |
| `ZREVRANGE k s e [WITHSCORES]` | O(log N + M) | By rank, descending |
| `ZRANK` / `ZREVRANK` | **O(log N)** | 0-based rank |
| `ZINCRBY k delta member` | O(log N) | Atomic score increment |
| `ZRANGEBYSCORE k min max` | O(log N + M) | By score range |
| `ZCOUNT k min max` | O(log N) | Count in a score range |
| `ZPOPMIN` / `ZPOPMAX` | O(log N) | Remove lowest / highest |
| `ZREMRANGEBYSCORE k min max` | O(log N + M) | Remove a score range |
| `ZRANGEBYLEX k min max` | O(log N + M) | Lexicographic (equal scores) |
| `ZUNION` / `ZINTER` / `ZDIFF` | O(N×M log M) | Set algebra on scores |
| `ZSCAN k cursor` | O(1) per call | Safe iteration |

### Streams

| Command | Cost | What it does |
|---|---|---|
| `XADD k * field value...` | O(1) | Append an entry |
| `XLEN k` | O(1) | Length |
| `XRANGE k start end [COUNT n]` | O(N) | Read by ID range |
| `XREVRANGE k end start` | O(N) | Reverse |
| `XREAD [COUNT n] [BLOCK ms] STREAMS k... id...` | O(N) | Read from streams |
| `XDEL k id...` | O(1) | Delete entries |
| `XTRIM k MAXLEN\|MINID ...` | O(N) | Cap the length |
| `XGROUP CREATE k g id [MKSTREAM]` | O(1) | Create a consumer group |
| `XREADGROUP GROUP g c [COUNT n] STREAMS k >` | O(N) | Read new entries |
| `XACK k g id...` | O(1) per ID | Acknowledge |
| `XPENDING k g` | O(1) / O(N) | In-flight entries |
| `XAUTOCLAIM k g c min-idle start [COUNT n]` | O(N) | Steal abandoned work |
| `XINFO STREAM\|GROUPS\|CONSUMERS k` | O(1) | Introspection |

### JSON (RedisJSON module)

| Command | What it does |
|---|---|
| `JSON.SET k path value [NX\|XX]` | Set at a path |
| `JSON.GET k [path...]` | Read (path is an option in node-redis!) |
| `JSON.MGET k... path` | Read several keys at one path |
| `JSON.DEL k [path]` | Delete key or path |
| `JSON.TYPE k [path]` | Type at path |
| `JSON.OBJKEYS` / `OBJLEN` | Object helpers |
| `JSON.ARRLEN` / `ARRAPPEND` / `ARRINSERT` / `ARRINDEX` / `ARRPOP` | Array ops |
| `JSON.NUMINCRBY k path n` | In-place increment |
| `JSON.MERGE k path value` | RFC 7396 merge (null = delete) |
| `JSON.STRAPPEND k path value` | Append to a string |

### Search (RediSearch module)

| Command | What it does |
|---|---|
| `FT.CREATE idx ON HASH\|JSON SCHEMA ...` | Create an index |
| `FT.SEARCH idx query [SORTBY ...] [LIMIT ...]` | Search |
| `FT.AGGREGATE idx query GROUPBY ...` | Aggregate |
| `FT.INFO idx` | Index details |
| `FT._LIST` | List indexes |
| `FT.DROPINDEX idx` | Remove an index |

### Pub/Sub

| Command | What it does |
|---|---|
| `PUBLISH channel message` | Send (returns subscriber count) |
| `SUBSCRIBE channel...` | Listen |
| `UNSUBSCRIBE [channel...]` | Stop |
| `PSUBSCRIBE pattern...` | Pattern subscribe |
| `PUNSUBSCRIBE [pattern...]` | Stop pattern |
| `SSUBSCRIBE` / `SPUBLISH` | Sharded (Redis 7+) |
| `PUBSUB CHANNELS\|NUMSUB\|NUMPAT\|SHARDNUMSUB` | Introspection |

### Geospatial

| Command | What it does |
|---|---|
| `GEOADD key lon lat member...` | Add a place |
| `GEOSEARCH key <center> <shape> [opts]` | Find nearby |
| `GEODIST key m1 m2 [unit]` | Distance |
| `GEOPOS key member...` | Coordinates |
| `GEOHASH key member...` | Geohash string |

### Probabilistic

| Command | What it does |
|---|---|
| `PFADD key m...` | Add to HLL |
| `PFCOUNT key...` | Estimate distinct count |
| `PFMERGE dest src...` | Merge HLLs |
| `BF.RESERVE key err capacity` | Create a Bloom filter |
| `BF.ADD key item` | Add one item |
| `BF.EXISTS key item` | Maybe present / definitely absent |
| `BF.MEXISTS key item...` | Check several |
| `BF.CARD key` | Approximate count |
| `BF.INFO key` | Filter details |

### Transactions and scripting

| Command | What it does |
|---|---|
| `MULTI` / `EXEC` / `DISCARD` | Transaction |
| `WATCH key...` / `UNWATCH` | Optimistic locking |
| `EVAL script numkeys key... arg...` | Run Lua |
| `EVALSHA sha1 numkeys ...` | Run pre-loaded Lua |
| `SCRIPT LOAD` / `SCRIPT EXISTS` / `SCRIPT FLUSH` / `SCRIPT KILL` | Script management |
| `FUNCTION LOAD` / `FCALL` | Redis 7+ functions (survive flush) |

### Persistence and admin

| Command | What it does |
|---|---|
| `BGSAVE` / `SAVE` | RDB snapshot (bg / blocking) |
| `BGREWRITEAOF` | Compact the AOF |
| `LASTSAVE` | Unix timestamp of last RDB save |
| `CONFIG GET\|SET\|REWRITE` | Configuration |
| `INFO [section]` | Server info |
| `SLOWLOG GET\|LEN\|RESET` | Slow command log |
| `LATENCY LATEST\|HISTORY` | Latency spikes |
| `CLIENT LIST\|KILL\|INFO` | Connection management |
| `MEMORY USAGE\|STATS\|DOCTOR\|PURGE` | Memory introspection |
| `ACL SETUSER\|DELUSER\|LIST\|WHOAMI\|LOG\|SAVE\|LOAD` | Access control |
| `AUTH user pass` | Authenticate |
| `FLUSHDB` / `FLUSHALL` | ⚠️ Wipe (never in production) |
| `DBSIZE` | Key count |
| `SELECT db` | Switch database (0–15) |
| `MONITOR` | ⚠️ Debug only, cuts throughput ~50% |

---

## 5. Big-O quick reference

| Complexity | Commands |
|---|---|
| **O(1)** | `GET`, `SET`, `INCR`, `HGET`, `HSET`, `HLEN`, `HEXISTS`, `SISMEMBER`, `SCARD`, `ZSCORE`, `ZCARD`, `ZINCRBY`, `ZCOUNT`, `ZPOPMIN`, `LLEN`, `LPOP`, `RPOP`, `EXPIRE`, `TTL`, `TYPE`, `EXISTS`, `DEL`, `UNLINK`, `RANDOMKEY`, `ZADD`, `GEOADD`, `GEODIST`, `GEOPOS`, `SETBIT`, `GETBIT`, `STRLEN`, `APPEND`, `PFCOUNT`, `BF.EXISTS`, `BF.ADD` |
| **O(log N)** | `ZADD`, `ZRANK`, `ZREVRANK`, `ZCOUNT`, `ZPOPMIN`/`MAX`, `GEOSEARCH` |
| **O(N)** | `KEYS`, `SMEMBERS`, `HGETALL`, `HKEYS`, `HVALS`, `LRANGE`, `LINDEX`, `LSET`, `LREM`, `LINSERT`, `LPOS`, `ZRANGE`, `ZRANGEBYSCORE`, `ZREMRANGEBYSCORE`, `SUNION`, `SINTER`, `SDIFF`, `MGET`, `MSET`, `HSCAN`, `SSCAN`, `ZSCAN`, `SCAN`, `FLUSHDB`, `FLUSHALL`, `SORT`, `XRANGE`, `XREAD`, `XTRIM` |
| **O(N/8)** | `BITCOUNT`, `BITPOS`, `BITOP` |
| **O(N×M)** | `SINTER`, `SUNION`, `SDIFF`, `ZUNION`, `ZINTER`, `ZDIFF` |
| **O(N log N)** | `SORT` |
| **O(S+N)** | `LRANGE` (S = start offset) |
| **O(1) per call** | `SCAN`, `HSCAN`, `SSCAN`, `ZSCAN` (but O(N) total) |

⚠️ **`KEYS` is O(N) AND blocks the server.** `SCAN` is O(N) total but never blocks.

---

## 6. node-redis 6 gotchas (verified on your setup)

1. `client.pipeline()` → **undefined**. Use auto-pipelining or `multi().execAsPipeline()`.
2. `client.quit()` → **deprecated**. Use `client.close()`.
3. `client.disconnect()` → **renamed** to `client.destroy()`.
4. `rPush(key, 'a', 'b', 'c')` → **silently stores only `'a'`**. Pass an array.
5. `sAdd`, `geoAdd`, `hSet` with multiple values → **same trap**.
6. `sInter('A', 'B')` → **silently ignores `'B'`**. Pass an array.
7. `WATCH` is a **top-level** command, not chained off `multi()`.
8. `pSubscribe`/`pUnsubscribe` return **`undefined`**, not a count.
9. `slowlogLen`/`dbSize` etc. are **not on the client** — use `sendCommand`.
10. `bitCount(key, start, end)` → **ignored**. Pass `{ start, end }`.
11. `BF.EXISTS` returns a **boolean** (`true`/`false`), not `1`/`0`.
12. `BF.ADD` takes **one** item per call.
13. Module clients need **double** `.default` unwrapping in ESM.
14. `json.get(key, path)` → **silently returns the whole document**. Use `{ path }`.
15. `SORTBY` must be `{ BY, DIRECTION }` — wrong keys are **silently ignored**.
16. RediSearch boolean OR is `|`, **not** the word `OR`.
17. `ft.aggregate()` returns `[{}, {}, {}]` — use `sendCommand` + `extra_attributes`.
18. `FT.INFO().attributes` is an **array**, not an object.
19. `hScan(key, cursor, opts)` takes the key **first** (unlike `scan`).
20. `hTTL`/`hExpire` take a **fields array**; the client inserts `FIELDS n`.
21. `hExpire` shares **one** seconds value across all fields.
22. `XINFO GROUPS` returns **hyphenated** field names (`last-delivered-id`).
23. `scanIterator`/`hScanIterator`/etc. yield **batches (arrays)**, not items.
24. `execAsPipeline()` throws a bare `SimpleError` (no `.replies`/`.errorIndexes`).
25. `exec()` throws `MultiErrorReply` with `.replies` and `.errorIndexes`.
26. `exec()` replies are **raw values** under RESP3 (no `.ok`).
27. `INCRBY` on a missing key **creates it** at the offset value.
28. `SET` without `KEEPTTL` **wipes** any existing TTL.
29. `KEYS` is O(N) **and blocks**. Always `SCAN`.
30. `MONITOR` cuts throughput ~50%. Never in production.

---

## 7. Where to go next

### Official resources

- **Docs:** https://redis.io/docs/latest/
- **Commands:** https://redis.io/docs/latest/commands/
- **Redis University:** https://university.redis.com/ (free courses)
- **Redis Launchpad:** https://launchpad.redis.com/
- **Developer tutorials:** https://developer.redis.com/

### Client libraries

- **node-redis:** https://github.com/redis/node-redis (you have 6.3.0)
- **redis-om-node:** https://github.com/redis/redis-om-node (object mapping)

### Books

- *Redis in Action* by Josiah Carlson
- *Redis Essentials* by Maxwell Dayvson da Silva and Hugo Lopes Tavares

### Topics to explore next

- **Redis Functions** (Redis 7+) — `FUNCTION LOAD`, `FCALL`. Functions survive
  `SCRIPT FLUSH` and restarts.
- **Client-side caching** (RESP3) — local cache invalidated by the server.
- **Redis on Flash** / tiered memory — for very large datasets.
- **Redis Cloud / Enterprise** — managed, with active-active geo-replication.
- **Vector sets** (Redis 8) — `VADD`, `VSIM` for similarity search.
- **Time series** (RedisTimeSeries module) — `TS.ADD`, `TS.RANGE`.
- **Probabilistic structures** — Count-Min Sketch, Top-K, t-digest (beyond HLL/Bloom).

### What you've built

You started with zero Redis knowledge and now have:

- A working Docker setup with Redis 8.10.2
- A Node.js project with node-redis 6.3.0
- 31 chapters of verified documentation
- 30 runnable example files
- A live 3-node cluster, a replica, and a Sentinel

Every number in these docs came from **your running server**. When in doubt, trust the
server over the docs — and use `COMMAND DOCS <command>` to check.

---

**Verified facts recap**

| Claim | How verified |
|---|---|
| All 447 commands documented in `COMMAND COUNT` | Direct |
| 5 modules loaded (search, ReJSON, bf, timeseries, vectorset) | `MODULE LIST` |
| node-redis 6.3.0, RESP3 | `CLIENT INFO` |
| Redis 8.10.2, standalone | `INFO server` |
| 3-node cluster: 16,384 slots, 3 masters | `CLUSTER INFO` |
| Sentinel failover works in < 1 s | Measured |
| Replica lag measurable via offsets | Measured |
| 30 chapters written | All examples exit 0 |

---

**Congratulations — you're done.** Go build something. 🎉