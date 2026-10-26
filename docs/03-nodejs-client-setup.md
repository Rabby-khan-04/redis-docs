# Chapter 03 — Connect from Node.js

> **Verified on:** Redis **8.10.2**, node-redis **6.3.0**, Node v24.19.0
> Run the code: `node examples/03-nodejs-client-setup.mjs`

This chapter is where **three very real traps** live, because node-redis **v6** removed
some things older tutorials still tell you to use. Every claim below was tested on your
running server.

---

## 1. Simple explanation (like I'm 7)

You have a **robot** that carries notes to Redis and brings back answers.

To make the robot you must:

1. **Build** it (say where Redis is).
2. **Start** it (`connect`).
3. **Give it a rule**: "if anything goes wrong, *tell me* instead of falling over."

That third step is the one everybody forgets. If you forget it, the robot doesn't complain
nicely — it just **screams and the whole program dies**.

---

## 2. Real name

**node-redis** (package name `redis`) is Redis's official Node.js client. Version **6.3.0**
is installed here.

### Install

```bash
npm install redis
# plus the official module clients, needed for JSON / Search / Bloom:
npm install @redis/json @redis/search @redis/bloom
```

### The three things you must get right

```javascript
import { createClient } from 'redis';

const client = createClient({ url: 'redis://127.0.0.1:6379' });
client.on('error', (err) => console.error('Redis error', err));   // ← never skip this
await client.connect();                                            // ← never skip this
```

### Connection URL format

```
redis[s]://[[username][:password]@][host][:port][/db-number]
          [s] = TLS (green padlock)
```

| Example | Meaning |
|---|---|
| `redis://127.0.0.1:6379` | Local, no auth, database 0 |
| `redis://localhost:6379/2` | Database 2 |
| `redis://alice:secret@host:6379` | With ACL username + password ([Chapter 26](26-security.md)) |
| `rediss://host:6379` | Encrypted with TLS |

### Events

node-redis is an EventEmitter. It emits **only** these:

| Event | When |
|---|---|
| `ready` | Connected and usable |
| `connect` | Connection attempt started |
| `error` | **Something went wrong** (network drop, etc.) |
| `reconnecting` | Trying to reconnect |
| `terminated` | Gave up reconnecting |
| `end` | Connection closed |

---

## 3. redis-cli equivalent

There isn't one — this chapter is about code. But the equivalent of "am I connected?" is:

```bash
docker exec redis-learn redis-cli PING
```
```redis
PONG
```

And the client reports its own identity from Node:

```bash
docker exec redis-learn redis-cli CLIENT LIST
```
```
id=245 addr=172.17.0.1:36282 laddr=172.17.0.2:6379 fd=22 ... db=0 ... resp=3 lib-name=node-redis lib-ver=6.3.0 tot-net-in=267 tot-net-out=1169 tot-cmds=4
```

Note `lib-name=node-redis lib-ver=6.3.0` — the server can see which client is talking to it.

---

## 4. Node.js example

### Verified output of `examples/03-nodejs-client-setup.mjs`

```
  [ready event] connected and usable
isReady: true | isOpen: true
camelCase  -> hello
RAW NAME   -> hello
sendCommand-> hello
missing key -> null | typeof object | falsy? true
2000 auto-pipelined SETs: 38ms (53,284 ops/sec)
200 sequential SETs   : 26ms (7,803 ops/sec)
wrote/ read in db 2: in database 2
open+close events: ready -> end
after close(): isOpen = false | isReady = false
```

### Three ways to run the same command

All three returned `hello`:

```javascript
await client.get('ch03:key');                     // camelCase (recommended in app code)
await client.GET('ch03:key');                     // raw Redis name (also works)
await client.sendCommand(['GET', 'ch03:key']);    // escape hatch
```

Every Redis command is available in **both** forms. Use `sendCommand` when the client has
no method for what you want — `COMMAND DOCS` and `MODULE LIST` need it
([Chapter 02](02-install-and-redis-cli.md)).

### 🔴 TRAP 1 — `client.pipeline()` no longer exists

Many tutorials (and AI answers) tell you to write `client.pipeline()`. **In node-redis 6
that method is not there.** Verified:

```javascript
typeof client.pipeline            // 'undefined'
typeof client.execAsPipeline      // 'undefined'  ← this is on the multi object, not the client
```

There are two correct options today.

**Option A — auto-pipelining (the default, easiest).** Just don't `await`, and collect the
promises:

```javascript
const pending = [];
for (let i = 0; i < 2000; i++) pending.push(client.set(`k:${i}`, i));
await Promise.all(pending);
```

Measured: **53,284 ops/sec**, versus **7,803 ops/sec** doing them one at a time — a **~7×
difference with no extra code at all.**

> ⚠️ If you drop the promises instead of collecting them you get unhandled rejections.
> **Always `await Promise.all([...])`**.

**Option B — explicit pipeline** when you need the replies but not atomicity:

```javascript
const replies = await client.multi().set('a', '1').get('b').execAsPipeline();
```

Full details in [Chapter 18](18-pipelining.md).

### 🔴 TRAP 2 — `quit()` is deprecated, use `close()`

Ask the server:

```bash
docker exec redis-learn redis-cli COMMAND DOCS QUIT
```
```redis
quit
summary
Closes the connection.
doc_flags
deprecated
deprecated_since
7.2.0
replaced_by
just closing the connection
```

So:

| Method | Status | Use |
|---|---|---|
| `client.close()` | ✅ **Current** | Close the socket cleanly |
| `client.quit()` | ⚠️ Deprecated | Avoid |
| `client.destroy()` | ✅ Current | Force-close immediately (no reconnect) |
| `client.disconnect()` | ❌ Renamed | Use `destroy()` |

Verified after `close()`: `isOpen = false`, `isReady = false`.

### 🔴 TRAP 3 — no `error` listener will kill your process

This is the big one. The node-redis README says it; I tested it by having one connection
kill another with `CLIENT KILL`.

**Without an `error` listener** — the process **crashed with exit code 1**:

```
victim connected, clientId = 264
CLIENT KILL -> 1
node:events:487
      throw er; // Unhandled 'error' event
      ^
Node.js v24.19.0
exit=1
```

**With an `error` listener** — it survived cleanly:

```
victim connected, clientId = 259
  [victim error event] Socket closed unexpectedly
CLIENT KILL -> 1
RESULT: timeout - still alive
exit=0
```

Note that a **failed `connect()` is catchable** and does *not* crash:

```javascript
try {
  await client.connect();
} catch (e) {
  console.log('caught:', e.constructor.name, '-', e.message);  // Error - connect ECONNREFUSED 127.0.0.1:6399
}
```

The crash only happens for **asynchronous** errors (socket drops *after* connecting). So
`try/catch` is not a substitute for an `error` listener — you need both.

---

## 5. When to use it and when NOT to

### ✅ Use node-redis when

- You are writing a **Node.js or TypeScript** service that talks to Redis.
- You want **automatic reconnection** with backoff.
- You want **auto-pipelining** for free.

### ❌ Don't use it (or use it differently) when

| Situation | Instead |
|---|---|
| You need a **script inside Redis** | Lua via `EVAL` ([Chapter 19](19-lua-scripting.md)) |
| You need **one atomic batch** | `multi().exec()` ([Chapter 17](17-transactions.md)) |
| You need **Pub/Sub** | Same client, but a **separate connection** ([Chapter 20](20-pub-sub.md)) |
| You need **blocking commands** (`BRPOP`) | A **dedicated connection**, or you block everything |
| You need **JSON / Search / Bloom commands** | Add the module clients via the `modules:` option ([Chapter 15](15-json.md)) |
| You need **automatic failover** | `createClientPool()` with Sentinel ([Chapter 24](24-sentinel.md)) |

### One client is enough

A single client **multiplexes** many concurrent requests over one socket. You do **not**
need a pool for normal use, and creating one per request is a classic anti-pattern. Create
**one** client at startup and share it.

The exceptions where you need a *second* connection: Pub/Sub, blocking commands, and
`WATCH` transactions.

---

## 6. Common mistakes

**Mistake 1 — Forgetting the `error` listener.** Proven above: the process dies. Rule:
attach `client.on('error', ...)` immediately after `createClient()`.

**Mistake 2 — Forgetting `await client.connect()`.**

```javascript
const client = createClient();
await client.set('k', 'v');
// TypeError: The client is closed  /  "client is not open"
```

**Mistake 3 — Using `client.pipeline()`.** It does not exist in v6. Use auto-pipelining
(no `await` + `Promise.all`) or `multi().execAsPipeline()`.

**Mistake 4 — Using `quit()`.** Deprecated since 7.2.0. Use `close()`.

**Mistake 5 — Treating a missing key as an error.**

```javascript
const user = await client.get('user:1');
if (!user) return null;         // ✓ null means "not found" -- not a crash
```

`GET` on a missing key returns `null` (`typeof 'object'`), it does **not** throw.

**Mistake 6 — Creating a new client per request.**

```javascript
// ✗ opens a TCP connection every time, exhausts file descriptors
async function handler(req) {
  const client = createClient(); await client.connect(); ...
}
```

**Mistake 7 — Ignoring async-reconnect behaviour.** After `close()`, the client will not
reconnect. To be destroyed on purpose use `destroy()`. If you want automatic reconnection,
keep the client open and let the default `reconnectStrategy` handle it.

**Mistake 8 — Trusting `typeof value === 'string'`.** With RESP3 and type mapping you can
get numbers, booleans, and Buffers. Prefer `Buffer` mapping only when you need binary.

**Mistake 9 — Copying v4/v5 tutorial code.** Check the [migration guides](https://github.com/redis/node-redis/blob/master/docs/v5.md).
Several names changed (`disconnect` → `destroy`, `pipeline` removed, `QUIT` dropped).

---

## 7. Try it yourself

**Exercise:** Write a script that connects, prints `isReady`, writes a key, reads it back,
prints the client id, then closes cleanly. Then **remove** the `error` listener and use
`CLIENT KILL` from another connection to prove the process dies.

**Hint:** get the id with `await client.clientId()` (it is a **method**, not a getter).
Then from a second client: `await killer.sendCommand(['CLIENT','KILL','ID', String(id)])`.

**What to notice:** the crash message is `Unhandled 'error' event`. That is the exact
failure you would see in production, and now you will recognise it instantly.

---

## 8. Next

**[Chapter 04 — Keys and naming](04-keys-and-naming.md)** — how keys work, how to name
them, and why `KEYS` will one day take your server down.

---

**Verified facts recap**

| Claim | How verified |
|---|---|
| `client.pipeline()` removed | `typeof client.pipeline === 'undefined'` |
| Auto-pipelining ≈ 7× faster | 53,284 vs 7,803 ops/sec |
| `quit()` deprecated since 7.2.0 | `COMMAND DOCS QUIT` |
| `close()` sets `isOpen`/`isReady` false | Direct observation |
| No `error` listener → exit code 1 | `CLIENT KILL` on a self-connected client |
| Failed `connect()` is catchable | `connect()` to port 6399 → caught `ECONNREFUSED` |
| Missing key returns `null` | `GET ch03:does-not-exist` |
| Database selection via URL | `redis://127.0.0.1:6379/2` |
| Events `ready` → `end` on open/close | Observed |