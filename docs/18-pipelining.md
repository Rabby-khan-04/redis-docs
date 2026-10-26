# Chapter 18 — Pipelining

> **Verified on:** Redis **8.10.2**, node-redis **6.3.0**
> Run the code: `node examples/18-pipelining.mjs`

---

## 1. Simple explanation (like I'm 7)

You keep asking the shopkeeper the same question, but you **wait for every answer** before
asking the next one.

```
"how much is tea?" → wait → "how much is milk?" → wait → ...
```

That's 10 questions = 10 trips to the counter. Slow.

If you instead **write all 10 questions on one slip of paper** and hand it over once, you get
all 10 answers back together. **One trip instead of ten.**

That is pipelining. Same work, far fewer trips.

---

## 2. Real name

**Pipelining** = sending multiple commands to Redis **without waiting for each reply**, then
reading all the replies together.

It reduces **network round trips**. It does **not** make Redis faster at executing commands —
verified: `redis-benchmark` already gets 93k ops/sec because it pipelines internally.

### 🔴 `client.pipeline()` no longer exists

Every tutorial and most AI answers will tell you to write `client.pipeline()`. **In
node-redis 6 that method is not there.** Verified:
`typeof client.pipeline === 'undefined'`.

There are two correct options today:

| | Auto-pipelining | Explicit pipeline |
|---|---|---|
| How | no `await` in a loop | `multi().execAsPipeline()` |
| Replies | one Promise per command | one array |
| Best for | most code | batching with fixed shape |

### Auto-pipelining

```javascript
// ✗ sequential: N round trips
for (let i = 0; i < 10000; i++) await client.set(`k:${i}`, i);

// ✓ auto-pipelined: node-redis batches everything issued in the same tick
const pending = [];
for (let i = 0; i < 10000; i++) pending.push(client.set(`k:${i}`, i));
await Promise.all(pending);
```

> ⚠️ **You must collect the promises.** Dropping them causes unhandled rejections.

### Explicit pipeline

```javascript
const replies = await client.multi()
  .set('a', '1')
  .set('b', '2')
  .incr('counter')
  .get('a')
  .execAsPipeline();
// → ['OK', 'OK', 1, '1']
```

Note: `multi()` here does **not** send `MULTI`. It is just a command builder.

---

## 3. redis-cli example

redis-cli pipelines with a shell pipe:

```bash
# One process, one connection, many commands
( echo "SET k1 a"; echo "SET k2 b"; echo "GET k1"; echo "GET k2" ) | redis-cli
```

Output:

```
OK
OK
"a"
"b"
```

You can also see the batching in `CLIENT INFO`:

```bash
docker exec redis-learn redis-cli CLIENT INFO | grep -o "avg-pipeline-len=[0-9]*"
```

A pipelined client reports a high `avg-pipeline-len`; a naive one reports ~1.

---

## 4. Node.js example

### Verified output of `examples/18-pipelining.mjs`

```
--- sequential: one round trip each ---
200 sequential SETs:  37ms (5,411 ops/sec)

--- auto-pipelined: no await inside the loop ---
2000 auto-pipelined SETs: 35ms (56,362 ops/sec)
  speedup vs sequential: 10.4x

--- explicit pipeline: multi().execAsPipeline() ---
1.3ms, replies -> [ 'OK', 'OK', 1, 'a' ]
  ^ NOT atomic (no MULTI/EXEC), but sent as ONE batch

--- transaction vs pipeline ---
multi().exec()            -> [ 'OK', null ] (atomic)
multi().execAsPipeline()  -> [ 'OK', null ] (batched, NOT atomic)

--- batching a big job ---
10,000 SETs in chunks of 1000: 61ms (10 round trips)
  total keys now: 12005

--- ⚠️ pipeline error handling ---
execAsPipeline THREW -> SimpleError: WRONGTYPE Operation against a key holding the wrong kind of value
  e.replies      -> undefined (undefined -- unlike multi().exec())
  e.errorIndexes -> undefined
  ^ NOTE THE DIFFERENCE:
    multi().exec()   -> throws MultiErrorReply WITH .replies/.errorIndexes
    execAsPipeline() -> throws a bare SimpleError, you LOSE the other replies
  fine  = ok  (it still ran!)
  fine2 = ok  (it still ran!)
  ^ every command in the pipeline still executes; only the reporting differs.

--- MGET 3 keys: 0.32ms -> [ 'a', 'b', 'c' ]
pipelined 3 GETs -> [ 'a', 'b', 'c' ] (same round trips, more control)

DBSIZE after cleanup: 0
```

### ⭐ 10.4× from removing `await`

```
200 sequential SETs:  37ms (5,411 ops/sec)
2000 auto-pipelined SETs: 35ms (56,362 ops/sec)
  speedup vs sequential: 10.4x
```

Same Redis, same commands, same machine. The only change is not waiting between sends. This
is the single highest-value performance habit in Redis, and it costs nothing.

(The numbers vary by machine — earlier runs on this same box showed 53,284 vs 7,803 and
59,754 vs 4,746. The ratio is consistently **10×** or better.)

### Batching a big job

```javascript
for (let start = 0; start < 10000; start += 1000) {
  const batch = client.multi();
  for (let i = start; i < start + 1000; i++) batch.set(`batch:${i}`, i);
  await batch.execAsPipeline();     // 10 round trips instead of 10,000
}
```

Verified:

```
10,000 SETs in chunks of 1000: 61ms (10 round trips)
  total keys now: 12005
```

Chunking matters for a practical reason: a pipeline of 10 million commands builds a 10-million-element
array in memory and writes a huge buffer to the socket, which can blow up buffers or trip
write timeouts. **1,000 per batch** is a safe default.

### ⚠️ Pipeline errors: `execAsPipeline` throws a bare `SimpleError`

This surprised me, so here is the verified comparison:

| | Throws | Has `.replies`? | Has `.errorIndexes`? |
|---|---|---|---|
| `multi().exec()` | `MultiErrorReply` | ✅ | ✅ |
| `multi().execAsPipeline()` | `SimpleError` | ❌ `undefined` | ❌ `undefined` |

```
execAsPipeline THREW -> SimpleError: WRONGTYPE Operation against a key holding the wrong kind of value
  e.replies      -> undefined (undefined -- unlike multi().exec())
  e.errorIndexes -> undefined
  fine  = ok  (it still ran!)
  fine2 = ok  (it still ran!)
```

**Every command in the pipeline still executes.** Only the reporting differs. So:

```javascript
try {
  const replies = await client.multi()....execAsPipeline();
} catch (e) {
  // you know something failed, but NOT which command or what the others returned
  log.error(e.message);   // you must re-check state yourself
}
```

If you need to know *which* command failed, use a transaction — it gives you
`.errorIndexes`.

---

## 5. When to use it and when NOT to

### ✅ Use pipelining when

- You send **many commands in a row** (bulk inserts, loops, fan-out reads).
- You are **far from Redis** (network latency dominates).
- You do **not** need atomicity.
- You want to **fill pipelines** (batch size 100–1000).

### ❌ Don't pipeline when

| Situation | Why | Use instead |
|---|---|---|
| Commands are **sent far apart** in time | Nothing to batch | Normal calls |
| You need **atomicity** | Pipelines don't guarantee it | [Transaction](17-transactions.md) |
| You need **per-command errors** | `execAsPipeline` loses them | `multi().exec()` |
| One giant batch (millions) | Memory + socket buffers | Chunk it |
| You need a **reply before deciding** the next command | The whole point is not waiting | Sequential |

### Pipeline vs transaction vs batching

| | Sequential | Pipeline | Transaction |
|---|---|---|---|
| Round trips | N | 1 (or N/chunk) | 1 |
| Atomic | ❌ | ❌ | ✅ |
| Errors visible | immediately | **first one only** | ✅ with `.errorIndexes` |

---

## 6. Common mistakes

**Mistake 1 — Calling `client.pipeline()`.**
It does not exist in v6. Use auto-pipelining or `execAsPipeline()`. Verified.

**Mistake 2 — Dropping the promises in auto-pipelining.**
```javascript
for (let i = 0; i < 100; i++) client.set(`k:${i}`, i);   // ✗ unhandled rejections
await Promise.all([...]);                                // ✓
```

**Mistake 3 — Not chunking large batches.**
A 1-million-command pipeline can exhaust memory or hit a socket write timeout.

**Mistake 4 — Expecting `execAsPipeline` not to throw.**
Verified: it throws a `SimpleError` on the first failing command, and you **lose** the other
replies.

**Mistake 5 — Expecting a pipeline to be atomic.**
Other clients can interleave between your commands. Verified: `execAsPipeline` is just
batching.

**Mistake 6 — Pipelining a `SUBSCRIBE` with normal commands.**
They share a connection; the subscriber connection goes into subscriber mode.

**Mistake 7 — Pipelining blocking commands.**
`BLPOP` in a pipeline blocks the whole batch.

**Mistake 8 — Assuming pipelining reduces server CPU.**
It reduces **network** cost. The server still executes each command.

**Mistake 9 — Using `multi()` for a pipeline and expecting atomicity.**
`multi().exec()` **is** atomic — you wanted speed, so use `execAsPipeline()`.

**Mistake 10 — Pipelines of `KEYS`/`SMEMBERS`.**
Batching a slow command makes the blocking *longer*, not shorter.

---

## 7. Try it yourself

**Exercise:** Insert 5,000 keys three ways and time each: (a) `await` in a loop, (b)
auto-pipelined, (c) chunked pipelines of 500. Then repeat with the Redis server on a
different machine (or with artificial latency) and see the ratio grow.

**Hint:** measure with `process.hrtime.bigint()` around each approach and delete keys between
runs with `SCAN` so you start clean. For (c):
`for (let s = 0; s < 5000; s += 500) { const b = client.multi(); for (...) b.set(...); await b.execAsPipeline(); }`.

**What to notice:** the ratio between (a) and (b) depends on **network latency**, not on CPU.
The bigger the round trip, the bigger the win. That's why pipelining matters most in
production, where Redis is rarely on localhost.

---

## 8. Next

**[Chapter 19 — Lua scripting](19-lua-scripting.md)** — running logic *inside* Redis, atomically,
with no round trip in the middle.

---

**Verified facts recap**

| Claim | How verified |
|---|---|
| `client.pipeline()` is undefined in v6 | Type check |
| Auto-pipelining ≈ **10×** faster | 5,411 vs 56,362 ops/sec |
| `execAsPipeline()` returns positional replies | `[ 'OK', 'OK', 1, 'a' ]` |
| `execAsPipeline` is **not** atomic | Documented + verified behaviour |
| Chunked pipeline: 10,000 writes in **10 round trips** | 61 ms |
| `execAsPipeline` throws a bare **`SimpleError`** | Caught; `.replies` undefined |
| `multi().exec()` throws `MultiErrorReply` with indexes | [Chapter 17](17-transactions.md) |
| All pipeline commands still **run** despite the error | `fine`/`fine2` both set |
| `MGET` and 3 pipelined `GET`s cost the same | 0.32 ms, both `[a,b,c]` |