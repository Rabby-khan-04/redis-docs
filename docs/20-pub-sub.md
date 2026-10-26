# Chapter 20 — Pub/Sub

> **Verified on:** Redis **8.10.2**, node-redis **6.3.0**
> Run the code: `node examples/20-pub-sub.mjs`

---

## 1. Simple explanation (like I'm 7)

Pub/Sub is a **radio station**.

The DJ (the publisher) broadcasts on a frequency (a channel). Anyone who has tuned their
radio to that frequency (subscribers) hears it. If your radio is off, you miss the show —
there is no recording.

Nobody is told "you were busy, here is what you missed." If you care about that, you need
a **stream** ([Chapter 14](14-streams.md)).

---

## 2. Real name

**Pub/Sub** = **publish/subscribe**: messages are sent to **channels**, and delivered to
every subscriber currently listening.

### Commands

| Command | What it does |
|---|---|
| `PUBLISH channel message` | Send a message; returns the **number of subscribers** that received it |
| `SUBSCRIBE channel...` | Listen to one or more channels |
| `UNSUBSCRIBE [channel...]` | Stop listening |
| `PSUBSCRIBE pattern...` | Subscribe to channels matching a glob |
| `PUNSUBSCRIBE [pattern...]` | Stop pattern subscription |
| `SSUBSCRIBE channel...` | Sharded pub/sub (Redis 7.0+) |
| `SUNSUBSCRIBE` / `SPUBLISH` | Sharded variants |
| `PUBSUB CHANNELS [pattern]` | List active channels |
| `PUBSUB NUMSUB channel...` | Subscriber counts |
| `PUBSUB NUMPAT` | Number of pattern subscriptions |
| `PUBSUB SHARDCHANNELS` / `SHARDNUMSUB` | Sharded variants |

### 🔴 The three things to remember

1. **Fire-and-forget.** No history, no replay, no acknowledgement.
2. **A subscriber connection cannot run normal commands.** It is in subscriber mode.
3. **Sharded pub/sub** (Redis 7.0+) scales across cluster nodes; regular pub/sub
   broadcasts across *every* node.

---

## 3. redis-cli example

```bash
docker exec -it redis-learn redis-cli
```

```redis
# Terminal 1:
127.0.0.1:6379> SUBSCRIBE news
Reading messages... (press Ctrl-C to quit)
1) "subscribe"
2) "news"
3) (integer) 1

# Terminal 2:
127.0.0.1:6379> PUBLISH news "hello world"
(integer) 1
```

Terminal 1 shows:

```redis
1) "message"
2) "news"
3) "hello world"
```

### Pattern subscribe

```redis
127.0.0.1:6379> PSUBSCRIBE order.* user.*
```

```redis
127.0.0.1:6379> PUBLISH order.created "order 123"
(integer) 1
```

Terminal 1 shows:

```redis
1) "pmessage"
2) "order.*"
3) "order.created"
4) "order 123"
```

### Introspection

```redis
127.0.0.1:6379> PUBSUB CHANNELS
1) "news"
127.0.0.1:6379> PUBSUB NUMSUB news order.created
1) "news"
2) (integer) 2
3) "order.created"
4) (integer) 0
127.0.0.1:6379> PUBSUB NUMPAT
(integer) 3
127.0.0.1:6379> PUBSUB SHARDNUMSUB
(empty array)
```

---

## 4. Node.js example

### Verified output of `examples/20-pub-sub.mjs`

```
--- basics ---
PUBLISH returned 1 (= number of subscribers that received it)
  [subscriber] news: hello world

--- ⚠️ pub/sub is fire-and-forget ---
PUBLISH to an un-subscribed channel -> 0 (0 subscribers = gone forever)
  the early subscriber still has 1 message(s) from `news` only.

now a late subscriber joins and wants the backlog:
  messages the late subscriber received: 0 ← ZERO, even though 1 was published earlier
  ^ pub/sub has NO history. No replay, no offset, no acknowledgement.
    If you need any of that, use STREAMS (chapter 14).

--- psubscribe: wildcard channels ---
  [pattern] order.created: order 123
  [pattern] order.paid: order 123
  [pattern] user.login: user 7
matched channels: [ 'order.created', 'order.paid', 'user.login' ]
  ^ "news.ignored" did not match order.* or user.*

--- sSubscribe: sharded pub/sub ---
typeof sSubscribe -> function
sharded pub/sub is available (Redis 7.0+)

--- management ---
PUBSUB CHANNELS -> [ 'news' ] (plain channels)
PUBSUB NUMPAT   -> 3 (pattern subscriptions)
PUBSUB NUMPAT after pUnsubscribe -> 0

--- introspection ---
PUBSUB NUMSUB news,order.created -> [ 'news', 2, 'order.created', 0 ]
PUBSUB SHARDNUMSUB -> []

--- ⚠️ why the subscriber connection matters ---
  A subscribed connection cannot run normal commands.
  node-redis handles this by putting the connection into subscriber mode.
  That is why you must duplicate() rather than reuse the main client.

DBSIZE after cleanup: 0
```

### The subscriber must be a separate connection

```javascript
const sub = client.duplicate();       // ⚠️ required
await sub.connect();

await sub.subscribe('news', (message, channel) => {
  console.log(`${channel}: ${message}`);
});

await client.publish('news', 'hello world');   // 1
```

### ⚠️ `pSubscribe`/`pUnsubscribe` return `undefined` in v6

Verified:

```
pUnsubscribe -> undefined channel(s) removed   ← older docs claimed a count
```

Don't rely on the return value. Use `PUBSUB NUMPAT` and `PUBSUB CHANNELS` to check.

### Pattern subscribe

```javascript
await sub.pSubscribe(['order.*', 'user.*'], (message, channel) => {
  // channel is the ACTUAL channel that matched, not the pattern
  console.log(channel, message);
});
```

### Sharded pub/sub (Redis 7.0+)

```javascript
const shard = client.duplicate();
await shard.connect();
await shard.sSubscribe('events', (msg) => console.log(msg));
await client.sPublish('events', 'payload');   // only shards that have subscribers
```

`PUBLISH` broadcasts to **every node** in a cluster. `SPUBLISH` only reaches the shard
that owns the channel's slot — far cheaper in a large cluster.

---

## 5. When to use it and when NOT to

### ✅ Use pub/sub when

- **Live notifications**: chat, presence, "user X is typing".
- **Cache invalidation**: "drop the cache for key K".
- **Fan-out**: one event, many listeners.
- **Real-time dashboards**: push updates to browsers.
- Anything where **missing a message is fine**.

### ❌ Don't use pub/sub when

| Situation | Why | Use instead |
|---|---|---|
| You need **history** | No replay | [Streams](14-streams.md) |
| You need **acknowledgement** | No ack | [Streams](14-streams.md) |
| You need **at-least-once** delivery | Fire and forget | [Streams](14-streams.md) |
| You need **ordering guarantees** | Not guaranteed across channels | [Streams](14-streams.md) |
| You need a **queue** (each item to one consumer) | Every subscriber gets everything | [List](08-lists.md) + `LPOP` or [Streams](14-streams.md) |

### 🔴 The golden rule

If your question is "did my subscriber receive this message?", **pub/sub is the wrong
tool**. Use a stream.

---

## 6. Common mistakes

**Mistake 1 — Reusing the main client for subscribing.**
A subscribed connection cannot run normal commands. Use `client.duplicate()`.

**Mistake 2 — Expecting `PUBLISH` to return a Promise that resolves to the message.**
It returns the **number of subscribers** that received it. `0` means nobody was listening.

**Mistake 3 — Late subscribers.**
Verified: a subscriber that joined after the publish got **0** messages. There is no
backlog. Ever.

**Mistake 4 — Assuming `pSubscribe` returns a count.**
It returns `undefined` in v6. Use `PUBSUB NUMPAT`.

**Mistake 5 — Using pub/sub for a job queue.**
Every subscriber gets every message. If you want "one worker takes one job", use a
[list](08-lists.md) or a [stream](14-streams.md).

**Mistake 6 — Forgetting that `PUBLISH` costs on every node.**
In a cluster, regular `PUBLISH` broadcasts to every node. For high-volume, use
`SPUBLISH`.

**Mistake 7 — Pattern subscriptions on busy clusters.**
`PSUBSCRIBE *` is a global broadcast and is expensive. Use plain `SUBSCRIBE` when you can.

**Mistake 8 — Not handling `sharded-channel-moved` events.**
In a cluster, sharded channels can move between nodes. node-redis emits
`sharded-channel-moved`. Listen for it if you care about delivery.

**Mistake 9 — Sending huge messages.**
Pub/Sub messages are not chunked; a 10 MB message blocks the connection.

**Mistake 10 — Assuming pub/sub is durable.**
It is not. No disk, no AOF, no replication of in-flight messages.

---

## 7. Try it yourself

**Exercise:** Build a cache-invalidation channel. When your app writes a key, it publishes
`"invalidate:<key>"` to `cache:events`. Every app server listens and calls `DEL` on the
local cache entry. Then measure: publish 1,000 invalidations and time how long it takes
until all 3 simulated servers have cleared their local cache.

**Hint:** use `sub.subscribe('cache:events', (msg) => { const key = msg.split(':')[1];
localCache.delete(key); })`. Use `Promise.all` over the three subscribers to wait for
completion.

**What to notice:** pub/sub is the only mechanism in Redis that is **true fan-out** with
sub-millisecond latency. A stream would work too, but the consumer-group overhead is
overkill for "the cache changed".

---

## 8. Next

**[Chapter 21 — Persistence: RDB and AOF](21-persistence.md)** — making Redis survive a
restart.

---

**Verified facts recap**

| Claim | How verified |
|---|---|
| `PUBLISH` returns subscriber count (`1`, then `0`) | Direct |
| Late subscriber received **0** messages | Direct |
| `pSubscribe`/`pUnsubscribe` return `undefined` | Direct |
| `PUBSUB CHANNELS` lists plain channels | `['news']` |
| `PUBSUB NUMPAT` counts pattern subs | `3` → `0` after unsub |
| `PUBSUB NUMSUB` returns `[key, count, ...]` | Direct |
| `PUBSUB SHARDNUMSUB` returns `[]` on standalone | Direct |
| `sSubscribe` exists (Redis 7.0+) | `typeof === 'function'` |
| `sharded-channel-moved` event documented | README |