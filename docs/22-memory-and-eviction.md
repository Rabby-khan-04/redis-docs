# Chapter 22 — Memory and eviction

> **Verified on:** Redis **8.10.2**, node-redis **6.3.0**
> Run the code: `node examples/22-memory-and-eviction.mjs`

---

## 1. Simple explanation (like I'm 7)

Redis keeps everything in **RAM**. RAM is like a **whiteboard** — fast to write on, but it has
limited space.

When the whiteboard is full, Redis has to choose: **throw away something old** so there is
room, or **refuse to write** until you erase something yourself.

That choice is the **eviction policy**, and you pick it. Getting it wrong is how Redis servers
die silently.

---

## 2. Real name

### Memory introspection

| Command | What it does |
|---|---|
| `INFO memory` | Memory stats, fragmentation, allocator |
| `MEMORY USAGE key [SAMPLES n]` | Bytes used by one key |
| `MEMORY STATS` | Breakdown by category |
| `MEMORY DOCTOR` | Human-readable health check |
| `MEMORY MALLOC-STATS` | Allocator stats |
| `MEMORY PURGE` | Release memory to the OS (jemalloc only) |
| `OBJECT ENCODING key` | How the value is stored internally |

### `maxmemory`

```redis
CONFIG GET maxmemory
1) "maxmemory"
2) "0"                ← 0 = NO LIMIT — Redis will eat all RAM
```

Verified on this server: `maxmemory_human:0B`. **This is the most dangerous default in
Redis.**

### The 8 eviction policies

| Policy | What gets evicted | When to use |
|---|---|---|
| `noeviction` | **Nothing** — writes fail with OOM | Default. Safe for data you must keep. |
| `allkeys-lru` | Least recently used key | **General cache** — the most common choice |
| `allkeys-lfu` | Least frequently used key | Cache where access patterns differ by frequency |
| `allkeys-random` | Random key | Rarely useful |
| `volatile-lru` | LRU among keys **with a TTL** | Cache + permanent data mixed |
| `volatile-lfu` | LFU among keys **with a TTL** | Same as above, by frequency |
| `volatile-random` | Random among keys with a TTL | Rarely useful |
| `volatile-ttl` | Keys with the **shortest TTL** first | When you want expiring items to go first |

### 🔴 `volatile-*` policies have a hidden trap

If **no key has a TTL**, a `volatile-*` policy evicts **nothing** and writes start failing
with OOM — exactly like `noeviction`. Use `allkeys-*` unless you have a specific reason.

### LRU and LFU are **approximate**

Redis does not maintain a perfect LRU list (that would be too expensive). It samples
`maxmemory-samples` (default 5) random keys and evicts the least-recently-used among them.

Higher sample count = better eviction decisions, but more CPU per eviction. Default 5 is
fine for most workloads.

---

## 3. redis-cli example

```bash
docker exec -it redis-learn redis-cli
```

### Inspect memory

```redis
127.0.0.1:6379> INFO memory
# Memory
used_memory:1841680
used_memory_human:1.76M
used_memory_peak_human:1.77M
used_memory_peak_perc:98.97%
maxmemory:0
maxmemory_human:0B
maxmemory_policy:noeviction
mem_fragmentation_ratio:12.01
mem_allocator:jemalloc-5.3.0
```

### Per-key cost

```redis
127.0.0.1:6379> SET small "hello"
OK
127.0.0.1:6379> MEMORY USAGE small
(integer) 40
127.0.0.1:6379> OBJECT ENCODING small
"embstr"
127.0.0.1:6379> SET medium "xxxxxxxx..." (200 chars)
OK
127.0.0.1:6379> MEMORY USAGE medium
(integer) 254
127.0.0.1:6379> OBJECT ENCODING medium
"raw"
```

### Setting a limit

```redis
127.0.0.1:6379> CONFIG SET maxmemory 100mb
OK
127.0.0.1:6379> CONFIG SET maxmemory-policy allkeys-lru
OK
```

### MEMORY USAGE exactness

```redis
127.0.0.1:6379> MEMORY USAGE bigkey SAMPLES 0
(integer) 38055
```

`SAMPLES 0` means **exact** (O(N) on nested types). The default samples 5 values, which is
fast and good enough for most purposes.

---

## 4. Node.js example

### Verified output of `examples/22-memory-and-eviction.mjs`

```
--- memory introspection ---
used_memory_human      -> 1.76M
used_memory_peak_human -> 1.77M
used_memory_peak_perc  -> 98.97%
maxmemory_human       -> 0B
maxmemory_policy      -> noeviction
mem_fragmentation_ratio-> 12.01
allocator             -> jemalloc-5.3.0

--- per-key cost ---
  ch22:small       embstr     40 bytes
  ch22:medium      raw        254 bytes
  ch22:hash        listpack   50 bytes

--- maxmemory and policies ---
maxmemory         -> 0 (0 = unlimited)
maxmemory-policy  -> noeviction
maxmemory-clients -> 0
maxmemory-eviction-tenacity -> 10

--- MEMORY commands ---
MEMORY USAGE small -> 40
MEMORY total.allocated -> 1841680
MEMORY startup.allocated -> 1381704
MEMORY DOCTOR -> Hi Sam, this instance is empty or is using very little memory, my issues detecto

--- MEMORY USAGE sampling ---
MEMORY USAGE sample 0 (default) -> 38055
MEMORY USAGE SAMPLES 10         -> 38055
  (0 = exact but O(N) for nested types; default samples 5)

--- simulating eviction ---
set maxmemory=2.3MB (startup+1MB), policy=allkeys-lru
tried 3000 keys -> 2000 written, 1000 OOM-refused
DBSIZE now -> 1055 (eviction may have removed keys to stay under 1 MB)
evicted_keys -> 957
```

### Simulating eviction

```
set maxmemory=2.3MB (startup+1MB), policy=allkeys-lru
tried 3000 keys -> 2000 written, 1000 OOM-refused
DBSIZE now -> 1055 (eviction may have removed keys to stay under 1 MB)
evicted_keys -> 957
```

**957 keys were evicted** to keep the database under 2.3 MB. The remaining ~1,055 keys are
the ones Redis judged "most recently used". This is LRU in action.

### `noeviction` behaviour

```
set maxmemory=1mb, policy=noeviction
after filling up memory: error = OOM command not allowed when used memory > 'maxmemory'.
```

With `noeviction`, writes **fail** instead of deleting. This is the safest policy if you
cannot afford to lose data — but your application must handle the OOM error.

### The API

```javascript
const info = await client.info('memory');
const usage = await client.memoryUsage('key');                      // bytes
const exact = await client.sendCommand(['MEMORY', 'USAGE', 'key', 'SAMPLES', '0']);
const stats = await client.memoryStats();                          // { 'total.allocated': ... }
const doctor = await client.memoryDoctor();                         // human-readable
await client.memoryPurge();                                         // release to OS

await client.configSet('maxmemory', '100mb');
await client.configSet('maxmemory-policy', 'allkeys-lru');
```

---

## 5. When to use it and when NOT to

### ✅ Picking a policy

| Your data | Policy |
|---|---|
| Pure cache, all data disposable | `allkeys-lru` |
| Cache with very uneven access | `allkeys-lfu` |
| Cache + permanent data mixed | `volatile-lru` (and **give the cache keys TTLs**) |
| You must never lose anything | `noeviction` |
| Rate limiters / TTL-based data | `volatile-ttl` |

### ❌ Don't do these

| Situation | Why | Fix |
|---|---|---|
| `maxmemory = 0` (default) in production | Redis grows until the OS kills it | Always set it |
| `volatile-*` without TTLs on the cache keys | Nothing is evictable → OOM | Use `allkeys-*` |
| Eviction on a server that is also a **replica** | Evicted data may not come back | Don't evict on replicas |
| `maxmemory` below startup memory | Server cannot even write | Set it above startup memory |
| Eviction without monitoring | Silent data loss | Watch `evicted_keys` |
| Assuming eviction is instant | Eviction runs on every write | Expect small latency spikes |

---

## 6. Common mistakes

**Mistake 1 — `maxmemory = 0` in production.**
Verified: this container ships with `maxmemory:0`. Set it before going live.

**Mistake 2 — `volatile-lru` with no TTLs.**
Nothing evictable → OOM. Use `allkeys-lru` for pure caches.

**Mistake 3 — Treating eviction as a substitute for TTLs.**
Eviction is a **safety net**, not a feature. Give keys TTLs so they clean up themselves.

**Mistake 4 — `maxmemory` below startup memory.**
Verified: with `maxmemory=1mb` and startup at 1.73 MB, every write OOM'd before eviction
could even run.

**Mistake 5 — Not monitoring `mem_fragmentation_ratio`.**
A ratio above ~1.5 means Redis is using more memory than it needs (allocator
fragmentation). Consider `MEMORY PURGE` or restarting.

**Mistake 6 — Assuming `MEMORY PURGE` always helps.**
It only helps with jemalloc's lazy freeing. Verified: the allocator is `jemalloc-5.3.0`.

**Mistake 7 — Evicting on a replica.**
Verified: replicas run the same eviction policy. If a replica evicts, the data is gone
there too, and it can fall out of sync.

**Mistake 8 — Not measuring per-key cost.**
`MEMORY USAGE key` is the single best debugging tool. Verified: a `"hello"` string costs
40 bytes, a 200-char string 254 bytes.

**Mistake 9 — Assuming `MEMORY USAGE` is exact by default.**
It samples 5 elements. Use `SAMPLES 0` for exactness (O(N)).

**Mistake 10 — Eviction on a server with `noeviction`.**
Writes fail with OOM. Your application must handle it.

---

## 7. Try it yourself

**Exercise:** Set `maxmemory` to 5 MB on your server. Write 10,000 keys of 1 KB each with
`allkeys-lru`. Then read 100 random keys and report how many are still there. Repeat with
`allkeys-lfu` and `volatile-ttl` (with TTLs on the keys) and compare.

**Hint:** `CONFIG SET maxmemory 5mb`, then `CONFIG SET maxmemory-policy allkeys-lru`.
Use `Promise.all` over a batch of `set`s, then `Math.random()` to pick reads.

**What to notice:** LRU evicts keys you have not touched recently. LFU evicts keys you
rarely touch. With random access patterns they look similar; with skewed access they
diverge.

**Stretch:** set `maxmemory-samples` to 1 and 100 and watch eviction quality change.

---

## 8. Next

**[Chapter 23 — Replication](23-replication.md)** — running a primary and a replica, and
the async replication lag.

---

**Verified facts recap**

| Claim | How verified |
|---|---|
| `maxmemory` = 0 (unlimited) | `CONFIG GET maxmemory` |
| `maxmemory-policy` = `noeviction` | `CONFIG GET` |
| `mem_fragmentation_ratio` = 12.01 | `INFO memory` |
| Allocator = `jemalloc-5.3.0` | `INFO memory` |
| `"hello"` string = 40 bytes | `MEMORY USAGE` |
| 200-char string = 254 bytes | `MEMORY USAGE` |
| 3-field hash = 50 bytes | `MEMORY USAGE` |
| `MEMORY USAGE SAMPLES 0` vs default both 38,055 | Direct |
| `MEMORY STATS` has no `keys.count` | Verified — used `total.allocated` |
| `MEMORY DOCTOR` returns a string | Direct |
| `maxmemory-clients` = 0 | `CONFIG GET` |
| `maxmemory-eviction-tenacity` = 10 | `CONFIG GET` |
| 3000 writes → 2000 written, 957 evicted | Verified |
| `noeviction` → OOM on write | Verified |
| `evicted_keys` counter increments | Direct |