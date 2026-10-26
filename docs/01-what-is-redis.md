# Chapter 01 — What is Redis?

> **Verified on:** Redis **8.10.2**, node-redis **6.3.0**, Node v24.19.0
> Run the code: `node examples/01-what-is-redis.mjs`

---

## 1. Simple explanation (like I'm 7)

Imagine you have a **memory board** in your classroom.

Every time somebody asks "what's the capital of France?", instead of opening a 500-page book
(the slow thing), you just **write "Paris" on a sticky note** and read it back instantly.

Redis is that memory board for your program. You can:

- **write** a note (`SET`)
- **read** it back (`GET`)
- **count** things up (`INCR`)
- **throw it away after an hour** (`EXPIRE`)

And it is *so* fast that you can do roughly **90,000 things per second** on a laptop.

The catch: the board **forgets everything when the power goes out** (unless you turn on
the "write it down on paper too" feature — that's [Chapter 21](../21-persistence.md)).

---

## 2. Real name

**Redis** is an **in-memory key–value data structure server**. Officially, "REmote DIctory
Services", but that name is historical and nobody uses it.

The important technical points:

| Fact | Why it matters |
|---|---|
| **In-memory** | Data lives in RAM, not on disk. That is *why* it is fast — no disk seek. |
| **Key–value** | You address data by a string key. Simple mental model. |
| **Data structure server** | Not just strings: lists, sets, hashes, sorted sets, streams… each with its own commands. |
| **Single-threaded** | One command runs to completion before the next starts. *One slow command blocks everyone.* |
| **Networked** | It listens on a TCP port (6379). Your app talks to it over the network, like a database. |
| **Not a relational database** | No tables, no joins, no SQL. It is a specialist tool. |

### Why is it fast? Three reasons

1. **No disk seek.** Reading from RAM is roughly 100× faster than reading from disk.
2. **Single-threaded means no locks.** Most databases coordinate many threads to stay
   consistent. Redis has one thread, so it never has to wait for a lock.
3. **Sophisticated data structures.** Many operations that would scan everything in a
   normal database are O(1) lookups here (see [Chapter 04](04-keys-and-naming.md)).

### The single-threaded trap — measured

This is the most important thing to understand early. While Redis runs *one* command, it
runs **no other command at all**. Here is a real measurement on this machine: one
4-million-iteration Lua loop (a deliberately slow command) ran for **35 ms**, and during
that window an **unrelated `GET` on a different connection took up to 25.8 ms** instead of
its usual ~0.3 ms.

That is why "always use O(1) commands" is not just good advice in this guide — it is
the difference between a fast server and a frozen one.

---

## 3. redis-cli example

```bash
docker exec -it redis-learn redis-cli
```

```redis
127.0.0.1:6379> PING
PONG
127.0.0.1:6379> SET greeting "hello"
OK
127.0.0.1:6379> GET greeting
"hello"
127.0.0.1:6379> DEL greeting
(integer) 1
```

Ask the server what it is:

```bash
docker exec redis-learn redis-cli INFO server
```

Verified output (trimmed):

```
# Server
redis_version:8.10.2
redis_mode:standalone
os:Linux 7.0.0-38-generic x86_64
arch_bits:64
multiplexing_api:epoll
gcc_version:14.2.0
process_id:1
tcp_port:6379
uptime_in_days:0
executable:/data/redis-server
io_threads_active:0
listener0:name=tcp,bind=*,bind=-::*,port=6379
```

Measure how fast it really is, using Redis's own benchmark tool:

```bash
docker exec redis-learn redis-benchmark -t set,get -n 100000 -c 50
```

Verified output (tail):

```
Summary:
  throughput summary: 93109.87 requests per second
  latency summary (msec):
          avg       min       p50       p95       p99       max
        0.300     0.120     0.271     0.463     0.591     1.111
```

> **Your numbers will differ.** Speed depends on your CPU, whether other programs are
> running, and Docker overhead. What matters is the *shape*: ~90k ops/sec, sub-millisecond
> average latency.

---

## 4. Node.js example

```javascript
// examples/01-what-is-redis.mjs
import { createClient } from 'redis';

const client = createClient({ url: 'redis://127.0.0.1:6379' });
await client.connect();                    // you must call connect() before using it

// Store a value under a name.
await client.set('greeting', 'hello');
console.log(await client.get('greeting'));  // 'hello'

await client.close();                      // close(), not quit() -- see chapter 03
```

### The full runnable version

`examples/01-what-is-redis.mjs` does four things. Here is its **verified output**:

```
GET greeting -> hello
10000 sequential SETs  : 1237ms  (8,081 ops/sec)
10000 SETs pipelined  : 124ms  (80,376 ops/sec)
memory before: 11.35M  ->  after 50k keys: 24.51M
one slow command took 35ms; an unrelated GET took up to 25.8ms
  redis_version:8.10.2
  redis_mode:standalone
  os:Linux 7.0.0-38-generic x86_64
  arch_bits:64
  multiplexing_api:epoll
  tcp_port:6379
  uptime_in_days:0
```

Three lessons hiding in that output:

**Lesson 1 — sequential commands cost a network round trip each.**
10,000 one-at-a-time writes took **1237 ms**. But the same 10,000 writes sent without
waiting for each reply took only **124 ms** — a **10× speedup**. Redis itself is not the
bottleneck; the *waiting* is. That is the entire idea behind
[pipelining](18-pipelining.md).

```javascript
// Slow: 10,000 round trips
for (let i = 0; i < 10000; i++) await client.set(`k:${i}`, i);

// Fast: one round trip
for (let i = 0; i < 10000; i++) client.set(`k:${i}`, i);   // no await
await client.ping();   // this awaits them all
```

**Lesson 2 — it really is RAM.** Adding 50,000 small keys pushed memory from
**11.35 MB to 24.51 MB**. Every key you create costs real RAM, forever, until you delete it
or set an expiry. See [Chapter 22](22-memory-and-eviction.md).

**Lesson 3 — one slow command hurts everyone.** Already explained above.

---

## 5. When to use it and when NOT to

### ✅ Use Redis when

- You need a **read or write in well under a millisecond** and the data can live in RAM.
- You want to **avoid querying your main database** too often (caching).
- You need **counters** that many servers must increment without stepping on each other.
- You need **temporary data that should disappear** on its own (sessions, rate limits).
- You need **leaderboards, queues, or locks** — things that are awkward in a relational DB.
- You need to **share state between many machines** (sessions, feature flags).

### ❌ Do NOT use Redis when

| Situation | Why not | Use instead |
|---|---|---|
| You must **never lose data** | It is RAM. Crash = gone (unless persistence is on). | PostgreSQL / MySQL |
| Data is **big** (> tens of GB) | RAM is expensive. You will run out and start evicting. | Object storage / a real database |
| You need **complex queries, joins, or reports** | Redis cannot do joins. You would hand-write everything. | SQL database |
| You need **strict ACID across many records** | Redis is single-node and not a relational engine. | PostgreSQL |
| You need **transactions over many keys** across shards | Hard in cluster mode. | SQL database |
| You need **full-text search over complex documents** | Possible with the Search module, but it is a different product. | Elasticsearch / Postgres |
| Your access pattern is **"scan everything and compute"** | Slow commands block the server (see the 35 ms example above). | A data warehouse / analytics DB |

### The trade-off, honestly

| | Redis | PostgreSQL |
|---|---|---|
| Single read | ~0.1 ms | ~1–10 ms |
| Data survives a crash | Only if persistence is enabled | Yes, always |
| Costs scale with | RAM (expensive) | Disk (cheap) |
| Complex reporting | Very hard | Easy |
| Setup effort | Low | Medium |

**The most common correct answer is: use both.** Redis in front of Postgres as a cache is
the textbook pattern.

---

## 6. Common mistakes

**Mistake 1 — Treating Redis as your primary database.**
You will lose data. Redis is a *cache and data-structure server* first. If you would be
unhappy losing it in a crash, it is the wrong tool.

**Mistake 2 — Assuming every command is fast.**
`GET` is instant. `KEYS *` on a large database can take seconds and **freezes the whole
server** while it runs. This is covered properly in [Chapter 04](04-keys-and-naming.md).

**Mistake 3 — Forgetting that one connection is not enough.**
Redis commands are pipelined and shared; one Node.js client handles many concurrent
requests. But **Pub/Sub and blocking commands need their own connection**
([Chapter 20](20-pub-sub.md)).

**Mistake 4 — Forgetting to `connect()`.**
```javascript
const client = createClient();          // not connected yet!
await client.set('k', 'v');             // TypeError: client is not open
await client.connect();                 // fix: connect first
```

**Mistake 5 — Assuming data disappears when your app restarts.**
It does not — Redis is a separate process. Your app closing does not clear the database.

**Mistake 6 — Putting megabytes into single keys.**
A 50 MB string is legal (max is 512 MB) but is painful to move over the network and blocks
the server while transferring. Keep values small; store many keys, or use a hash.

**Mistake 7 — Not setting a memory limit.**
By default `maxmemory` is `0`, meaning **unlimited** — Redis will happily consume all your
RAM until the OS kills it. Verified on this machine: `maxmemory:0`. Set it in production.

---

## 7. Try it yourself

**Exercise:** Write a script that stores 5,000 keys, then measures how long it takes to
read them back — once sequentially (`await` each) and once without awaiting.

**Hint:** copy the timing pattern from section 4 — `process.hrtime.bigint()` before and
after, then subtract and divide by `1e6` to get milliseconds. Count how many you did per
second by dividing `5000 / ms * 1000`.

**What to notice:** the non-awaited version should be several times faster. That difference
is the round trip, and understanding it is what makes the rest of this guide make sense.

---

## 8. Next

**[Chapter 02 — Install and redis-cli](02-install-and-redis-cli.md)** — how the Docker
container is running, how to talk to it by hand, and how to inspect the server.

---

**Verified facts recap for this chapter**

| Claim | How verified |
|---|---|
| 90k ops/sec | `redis-benchmark -t set,get -n 100000 -c 50` |
| Version 8.10.2 | `INFO server` |
| Single-threaded blocking | 4M-iteration Lua loop → 35 ms block, unrelated GET up to 25.8 ms |
| Memory grows with keys | `INFO memory` 11.35 MB → 24.51 MB after 50k keys |
| Pipelining ~10× faster | 1237 ms sequential vs 124 ms pipelined |