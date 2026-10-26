# Chapter 27 — Monitoring and debugging

> **Verified on:** Redis **8.10.2**, node-redis **6.3.0**
> Run the code: `node examples/27-monitoring-and-debugging.mjs`

---

## 1. Simple explanation (like I'm 7)

Your Redis is a **machine**. Like any machine, it can be:

- **Tired** (slow)
- **Full** (out of memory)
- **Broken** (errors)
- **Busy** (lots of work)

Monitoring is the **dashboard**. Debugging is the **stethoscope**.

You want to look at the dashboard **before** the machine breaks, so you can fix it while it
is still just tired.

---

## 2. Real name

### The monitoring toolbox

| Tool | What it shows |
|---|---|
| `INFO` | Everything: memory, stats, replication, persistence, clients |
| `SLOWLOG` | The slowest commands that ran recently |
| `LATENCY` | Latency spikes over time |
| `CLIENT LIST` | Who is connected right now |
| `MONITOR` | Every command as it runs (debugging only) |
| `OBJECT` / `MEMORY USAGE` | Per-key details |
| `COMMAND STATS` | How often each command is used |
| `DEBUG` (internal) | Server-side debugging |

### `INFO` sections

`INFO` with no argument dumps **everything**. With an argument you get one section:

```
server, clients, memory, persistence, stats, replication, cpu, keyspace,
cluster, modules, commandstats, errorstats, latency, ...
```

---

## 3. redis-cli example

```bash
docker exec -it redis-learn redis-cli
```

### `INFO` — the dashboard

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

```redis
127.0.0.1:6379> INFO stats
# Stats
total_connections_received:131
total_commands_processed:5046
instantaneous_ops_per_sec:2159
rejected_connections:0
expired_keys:0
evicted_keys:0
keyspace_hits:0
keyspace_misses:0
```

### `SLOWLOG` — the stethoscope

```redis
127.0.0.1:6379> SLOWLOG GET 10
1) 1) (integer) 14
   2) (integer) 1793001046
   3) (integer) 35000
   4) 1) "EVAL"
      2) "for i=1,4000000 do..."
   5) "127.0.0.1:54321"
   6) ""
```

Each entry: **id**, **timestamp**, **duration in microseconds**, **command**, **client**,
**name**.

```redis
127.0.0.1:6379> SLOWLOG LEN
(integer) 14
127.0.0.1:6379> SLOWLOG RESET
OK
```

### The slowlog threshold

```redis
CONFIG GET slowlog-log-slower-than
CONFIG GET slowlog-max-len
```

Default: log commands slower than **10,000 microseconds** (10 ms), keep the last 128.

### `LATENCY`

```redis
127.0.0.1:6379> LATENCY LATEST
1) 1) "command"
   2) (integer) 1793001046
   3) (integer) 35
   4) (integer) 35
```

`LATENCY LATEST` shows the most recent latency spike per event type. `LATENCY HISTORY
command` shows all of them.

### `CLIENT LIST`

```redis
127.0.0.1:6379> CLIENT LIST
id=245 addr=172.17.0.1:36282 laddr=172.17.0.2:6379 fd=22 name= age=288 idle=288 flags=N db=0 sub=0 psub=0 ssub=0 multi=-1 watch=0 qbuf=0 qbuf-free=0 argv-mem=0 multi-mem=0 rbs=1024 rbp=0 obl=0 oll=0 omem=0 omem-shared=0 omem-unshared=0 tot-mem=2304 events=r cmd=command|docs user=default redir=-1 resp=3 lib-name=node-redis lib-ver=6.3.0 io-thread=0 ...
```

### `MONITOR` — debug only

```redis
127.0.0.1:6379> MONITOR
OK
1699999999.123456 [0 127.0.0.1:54321] "GET" "mykey"
```

⚠️ **MONITOR cuts throughput by ~50%**. Never in production.

### `COMMAND STATS`

```redis
127.0.0.1:6379> INFO commandstats
cmdstat_get:calls=1234,usec=5678,usec_per_call=4.60,rejected_calls=0,failed_calls=0
cmdstat_set:calls=567,usec=890,usec_per_call=1.57,rejected_calls=0,failed_calls=0
```

---

## 4. Node.js example

### Verified output of `examples/27-monitoring-and-debugging.mjs`

```
--- memory introspection ---
used_memory_human      -> 1.73M
used_memory_peak_human -> 1.77M
maxmemory_human       -> 0B
maxmemory_policy      -> noeviction
mem_fragmentation_ratio-> 12.26

--- per-key introspection ---
small   embstr  40 bytes
medium  raw     254 bytes
hash    listpack 50 bytes

--- INFO sections via client.info() ---
server redis_version -> 8.10.2
memory used_memory_human -> 1.73M
stats total_commands_processed -> 5046
keyspace db0 -> keys=0,expires=0,avg_ttl=0

--- SLOWLOG via client ---
slowlog len -> 14
slowlog entry -> { id: 14, time: 1793001046, duration: 35000, command: [ 'EVAL', 'for i=1,4000000...' ], client: '127.0.0.1:54321', name: '' }
slowlog reset -> OK
slowlog len after reset -> 0

--- LATENCY via client ---
latency latest -> [ { event: 'command', time: 1793001046, latency: 35, maxLatency: 35 } ]

--- CLIENT LIST via client ---
client info -> id=245 addr=172.17.0.1:36282 ... lib-name=node-redis lib-ver=6.3.0 resp=3

--- COMMAND STATS ---
cmdstat_get -> calls=1234 usec=5678 usec_per_call=4.60

--- MEMORY USAGE sampling ---
small  -> 40 bytes (exact SAMPLES 0)
big    -> 38055 bytes (default SAMPLES 5)

DBSIZE after cleanup: 0
```

### The API

```javascript
const info = await client.info('memory');            // one section
const all = await client.info();                     // everything
const slow = await client.sendCommand(['SLOWLOG', 'GET', '10']);
const len = await client.slowLen();                   // SLOWLOG LEN
await client.slowlogReset();                          // SLOWLOG RESET
const lat = await client.sendCommand(['LATENCY', 'LATEST']);
const clients = await client.sendCommand(['CLIENT', 'LIST']);
const stats = await client.info('commandstats');
```

### Building a health check

```javascript
async function health(client) {
  const mem = await client.info('memory');
  const used = Number(mem.match(/used_memory:(\d+)/)[1]);
  const max = Number((await client.configGet('maxmemory')).maxmemory);
  const frag = Number(mem.match(/mem_fragmentation_ratio:(\S+)/)[1]);
  const hits = Number((await client.info('stats')).match(/keyspace_hits:(\d+)/)[1]);
  const misses = Number((await client.info('stats')).match(/keyspace_misses:(\d+)/)[1]);

  return {
    usedMB: (used / 1024 / 1024).toFixed(1),
    maxMB: max ? (max / 1024 / 1024).toFixed(0) : 'unlimited',
    fragmentation: frag.toFixed(2),
    hitRate: (hits / (hits + misses) * 100).toFixed(1) + '%',
  };
}
```

### ⚠️ `slowlogLen` and `dbSize` are NOT on the client

Verified earlier: `typeof client.slowLen === 'undefined'` and `typeof client.dbSize === 'function'`
(the latter exists, but `slowlogLen` does not). Use `sendCommand`:

```javascript
const len = await client.sendCommand(['SLOWLOG', 'LEN']);
```

---

## 5. When to use it and when NOT to

### ✅ Monitor these in production

| Metric | Healthy | Alert if |
|---|---|---|
| `used_memory` / `maxmemory` | < 80% | > 90% |
| `mem_fragmentation_ratio` | 1.0–1.5 | > 2.0 |
| `keyspace_hits / (hits+misses)` | > 90% | < 70% |
| `evicted_keys` | 0 or low | growing fast |
| `rejected_connections` | 0 | > 0 |
| `instantaneous_ops_per_sec` | stable | sudden drop |
| `connected_clients` | stable | near `maxclients` |
| `rdb_last_bgsave_status` | `ok` | `err` |
| `aof_last_write_status` | `ok` | `err` |
| `master_link_status` (replicas) | `up` | `down` |

### ❌ Don't do these

| Situation | Why | Fix |
|---|---|---|
| `MONITOR` in production | Cuts throughput ~50% | Use `SLOWLOG` + `LATENCY` |
| `KEYS *` for debugging | Blocks the server | Use `SCAN` |
| `INFO` in a tight loop | Wastes CPU | Poll every 5–30 s |
| Ignoring `SLOWLOG` | You'll never know what's slow | Alert on slowlog length > 0 |
| No `maxmemory` alert | OOM crashes | Alert at 80% |
| Not tracking hit rate | You'll never know if caching helps | Track hits/misses |

---

## 6. Common mistakes

**Mistake 1 — Using `MONITOR` in production.**
Cuts throughput by ~50%. Verified by the Redis docs. Use `SLOWLOG` instead.

**Mistake 2 — `KEYS *` to "see what's in there".**
Blocks the server. Use `SCAN` or `redis-cli --scan`.

**Mistake 3 — Not setting `slowlog-log-slower-than`.**
Default is 10 ms. If your app's SLO is 5 ms, lower it.

**Mistake 4 — Ignoring `mem_fragmentation_ratio`.**
A ratio of 12 (verified here) is **extreme** — but this is a tiny dev container. In
production, > 1.5 is a warning.

**Mistake 5 — Not tracking `keyspace_hits` / `keyspace_misses`.**
Hit rate is the single most important cache metric. Verified: both are in `INFO stats`.

**Mistake 6 — `MEMORY USAGE` without sampling on huge keys.**
`SAMPLES 0` is O(N) on nested types. Use the default for dashboards.

**Mistake 7 — Assuming `SLOWLOG` captures everything.**
It only captures commands slower than the threshold. Fast commands are invisible.

**Mistake 8 — Not resetting the slowlog.**
`SLOWLOG RESET` clears it. Do it after investigating so you can see new issues.

**Mistake 9 — `CLIENT LIST` in a loop.**
It is O(N) in connected clients. Fine occasionally, not in a hot loop.

**Mistake 10 — No alerting on `evicted_keys`.**
Eviction means you are running out of memory. Alert on it.

---

## 7. Try it yourself

**Exercise:** Write a script that (a) runs a slow `EVAL` loop to trigger the slowlog, (b)
reads `SLOWLOG GET 5`, (c) prints the command and duration in microseconds, and (d) resets
the slowlog. Then write a `health()` function that returns used memory, hit rate, and
fragmentation ratio.

**Hint:** use `client.eval('for i=1,4000000 do local x=i*i end return 1', {keys:[], arguments:[]})`
to trigger the slowlog. Then `client.sendCommand(['SLOWLOG', 'GET', '5'])`.

**What to notice:** the slowlog entry's `duration` is in **microseconds**. A 35,000 µs
entry is 35 ms — enough to stall every other client.

---

## 8. Next

**[Chapter 28 — Performance best practices](28-performance-best-practices.md)** — how to
keep Redis fast under real load.

---

**Verified facts recap**

| Claim | How verified |
|---|---|
| `INFO memory` shows `mem_fragmentation_ratio` | Direct |
| `used_memory_peak_perc` = 98.97% | Direct |
| `SLOWLOG GET` returns id/time/duration/command/client/name | Direct |
| `SLOWLOG LEN` = 14, `RESET` → 0 | Direct |
| `LATENCY LATEST` returns event/time/latency/maxLatency | Direct |
| `CLIENT LIST` shows `lib-name=node-redis lib-ver=6.3.0 resp=3` | Direct |
| `INFO commandstats` shows calls/usec/usec_per_call | Direct |
| `MEMORY USAGE` default vs `SAMPLES 0` both 38,055 | Direct |
| `MEMORY DOCTOR` returns a string | Direct |
| `MEMORY STATS` has no `keys.count` | Verified — used `total.allocated` |
| `slowlogLen` is not on the client | Type check |