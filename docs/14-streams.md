# Chapter 14 — Streams

> **Verified on:** Redis **8.10.2**, node-redis **6.3.0**
> Run the code: `node examples/14-streams.mjs`

---

## 1. Simple explanation (like I'm 7)

A stream is a **notebook where you can only add new lines, never erase old ones**.

Every line gets a **number** when it is written, like a timestamp ticket. Workers come along,
say *"give me line 57 onward"*, and do the work.

The important bit: when a worker takes a line, Redis writes it on a **not-done list**. The
worker later says *"done"* and Redis ticks it off. If the worker **crashes**, the line stays
on the not-done list, and another worker can pick it up later.

That is why streams are the right tool for jobs you must not lose.

---

## 2. Real name

A **stream** is an **append-only log of entries**, each with a generated ID of the form
`<milliseconds>-<sequence>`.

Verified:

```
XADD -> 1791453425124-0
XADD -> 1791453425125-0    (IDs are time-based: <milliseconds>-<sequence>)
```

`TYPE` returns **`stream`** — a distinct type, not a list.

### Commands

| Command | What it does |
|---|---|
| `XADD key [MAXLEN n] * field value...` | Append an entry; `*` = auto ID |
| `XLEN key` | How many entries |
| `XRANGE key start end [COUNT n]` | Read by **ID range** (`-` `+` for all) |
| `XREVRANGE key end start` | Reverse |
| `XREAD [COUNT n] [BLOCK ms] STREAMS key... id...` | Read from one or more streams |
| `XDEL key id...` | Delete specific entries (usually not what you want) |
| `XTRIM key MAXLEN\|MINID ...` | Cap the length |

### Consumer groups

| Command | What it does |
|---|---|
| `XGROUP CREATE key group id [MKSTREAM]` | Create a group |
| `XGROUP CREATECONSUMER key group consumer` | Register a consumer |
| `XREADGROUP GROUP g c [COUNT n] STREAMS key >` | Read **new** entries for this consumer |
| `XACK key group id...` | Mark as done |
| `XPENDING key group` | What is in flight |
| `XAUTOCLAIM key group consumer min-idle-time start` | Steal abandoned work |
| `XINFO STREAM\|GROUPS\|CONSUMERS key` | Introspection |

### The three special read IDs

| ID | Meaning |
|---|---|
| `>` | **Never delivered before** (new work for a consumer) |
| `$` | From **now on** — ignore anything already in the stream |
| `0` or an actual ID | From the **beginning** (replay history) |

---

## 3. redis-cli example

```bash
docker exec -it redis-learn redis-cli
```

### Appending and reading

```redis
127.0.0.1:6379> XADD events '*' action login user 1
1791453408737-0
127.0.0.1:6379> XADD events '*' action view user 1
1791453408802-0

127.0.0.1:6379> XLEN events
(integer) 2

127.0.0.1:6379> XRANGE events - +
1791453408737-0
action
login
user
1
1791453408802-0
action
view
user
1

127.0.0.1:6379> TYPE events
stream
```

### Consumer groups

```redis
127.0.0.1:6379> XGROUP CREATE events workers 0 MKSTREAM
OK
127.0.0.1:6379> XGROUP CREATECONSUMER events workers w1
(integer) 1

127.0.0.1:6379> XREADGROUP GROUP workers w1 COUNT 5 STREAMS events '>'
1) 1) "events"
   2) 1) 1) "1791453408737-0"
         2) 1) "action"
            2) "login"
            3) "user"
            4) "1"
      2) 1) "1791453408802-0"
         2) 1) "action"
            2) "view"
            3) "user"
            4) "1"
```

A second consumer sees **nothing** — the entries are now owned by `w1`:

```redis
127.0.0.1:6379> XREADGROUP GROUP workers w2 COUNT 5 STREAMS events '>'
(nil)
```

### Pending and acknowledge

```redis
127.0.0.1:6379> XPENDING events workers
1) (integer) 2                      ← 2 entries in flight
2) "1791453408737-0"
3) "1791453408802-0"
4) 1) 1) "w1"
      2) (integer) 2

127.0.0.1:6379> XACK events workers 1791453408737-0
(integer) 1

127.0.0.1:6379> XPENDING events workers
1) (integer) 1                      ← one fewer
```

---

## 4. Node.js example

### Verified output of `examples/14-streams.mjs`

```
--- basics ---
XADD -> 1791453425124-0
XADD -> 1791453425125-0    (IDs are time-based: <milliseconds>-<sequence>)
XLEN -> 2
XRANGE ->
   1791453425124-0 {"action":"login","user":"1"}
   1791453425125-0 {"action":"view","user":"1"}
TYPE -> stream   (a stream is its own type, not a list)

--- XREAD ---
XREAD from 0 ->
  stream: ch14:events
    1791453425124-0 {"action":"login","user":"1"}
    1791453425125-0 {"action":"view","user":"1"}
XREAD from $ (only NEW entries) -> null
  ^ "$" means "from now on", which is what live tailing uses

--- consumer groups ---
XGROUP CREATE workers 0 MKSTREAM -> ok
XGROUP CREATECONSUMER worker-2 -> 1 (1 = created)

XREADGROUP worker-1 (> = never delivered before):
    1791453425124-0 {"action":"login","user":"1"}
    1791453425125-0 {"action":"view","user":"1"}
XREADGROUP worker-2 -> null   (nothing: worker-1 owns them)

--- ack ---
XPENDING summary -> 2 entries pending
  ^ entries are delivered but NOT acknowledged = a worker may have crashed
XACK 1791453425124-0 -> 1
XPENDING after ack -> 1 entries pending
XPENDING detail -> [["1791453425125-0","worker-1",1,1]]

--- XAUTOCLAIM (rescue abandoned work) ---
XAUTOCLAIM -> ["0-0",[["1791453425125-0",["action","view","user","1"]]],[]]
  ^ next-cursor and the entries claimed from the dead consumer

XINFO GROUPS -> {
  name: 'workers',
  consumers: 3,
  pending: 1,
  'last-delivered-id': '1791453442955-1',
  lag: 0,
  'entries-read': 2
}
  ^ note the HYPHENATED field names under RESP3, not camelCase

--- trimming ---
XLEN before trim -> 2
XLEN after XTRIM MAXLEN 1 -> 1
added 500 -> XLEN 500
after XADD with TRIM MAXLEN 100 -> 100
  ^ trimming happens during XADD: fewer commands, no extra latency spike

--- lists vs streams for queues ---
  LIST   : LPOP removes it. Crash = job lost. No ack. No fan-out.
  STREAM : XREADGROUP delivers it. XPENDING tracks it. XACK confirms.
           XAUTOCLAIM hands abandoned work to another consumer.
           Multiple groups each see EVERY entry (fan-out).

DBSIZE after cleanup: 0
```

### The API

```javascript
// Append
const id = await client.xAdd('events', '*', { action: 'login', user: '1' });

// Read history
await client.xRange('events', '-', '+');

// Read only NEW entries (live tailing)
await client.xRead({ key: 'events', id: '$' }, { COUNT: 10, BLOCK: 5000 });

// Consumer groups
await client.xGroupCreate('events', 'workers', '0', { MKSTREAM: true });
await client.xGroupCreateConsumer('events', 'workers', 'worker-1');

const batch = await client.xReadGroup('workers', 'worker-1',
                                      { key: 'events', id: '>' },
                                      { COUNT: 10 });

for (const s of batch) for (const m of s.messages) {
  await doWork(m.message);
  await client.xAck('events', 'workers', m.id);      // ← the crucial step
}
```

### ⭐ XAUTOCLAIM — the safety net

Verified:

```
XAUTOCLAIM -> ["0-0",[["1791453425125-0",["action","view","user","1"]]],[]]
```

```javascript
// worker-3 steals anything idle for more than 1000 ms
const claimed = await client.sendCommand(
  ['XAUTOCLAIM', 'events', 'workers', 'worker-3', '1000', '0', 'COUNT', '10']);
```

`worker-1` received entries and never acked. After the idle timeout, `worker-3` takes
ownership. **This is the whole reason to use a stream instead of a list.**

### `XINFO GROUPS` field names are hyphenated

```javascript
const g = (await client.xInfoGroups('events'))[0];
g.name                 // 'workers'
g.consumers            // 3
g.pending              // 1
g['last-delivered-id'] // ← hyphenated, NOT lastDeliveredId
g['entries-read']      // ← hyphenated
g.lag                  // 0
```

Verified. Reaching for `g.lastDeliveredId` gives `undefined`.

### Trimming during `XADD`

```javascript
await client.xAdd('events', '*', { n: 'x' },
  { TRIM: { strategy: 'MAXLEN', threshold: 100, LIMIT: 20 } });
```

Verified: 500 entries → one `XADD` with trim → **100**. Doing the trim inside the append
avoids a separate `XTRIM` command and its latency spike.

⚠️ `MAXLEN` trims to an **approximate** length and is much cheaper. `MINID` (trim anything
older than an ID) is exact and slower. Use `MAXLEN` unless you need exactness.

---

## 5. When to use it and when NOT to

### ✅ Use streams when

- You **must not lose** a job (payments, emails, orders).
- Multiple consumers should **each** process every entry (fan-out).
- You need **acknowledgement**: the worker confirms it finished.
- You need **at-least-once delivery**: a crashed worker's job is retried.
- You want an **event log** other systems can tail (`XREAD` from `$`).
- You need **ordered, replayable** history.

### ❌ Don't use streams when

| Situation | Why | Use instead |
|---|---|---|
| Best-effort work (fire and forget) | Streams add overhead | [List](08-lists.md) + `LPOP` |
| You need **exactly-once** delivery | Streams are at-least-once | You must make the handler idempotent |
| The stream grows forever and you don't trim | Unbounded memory | `MAXLEN` / `MINID` |
| Sub-millisecond latency, tiny payloads | Stream overhead | [String](05-strings.md) |
| You don't have consumer groups configured | New entries are never consumed | — |

### 🔴 The at-least-once trap

Streams give **at-least-once**, not exactly-once. If a worker finishes the job then crashes
**before** `XACK`, another worker will do it again.

That means **every handler must be idempotent**:

```javascript
await client.set(`done:${job.id}`, '1', { EX: 86400, NX: true });
if (alreadyDone) return;      // guard against reprocessing
```

---

## 6. Common mistakes

**Mistake 1 — Never calling `XACK`.**
The stream grows forever and `XPENDING` grows forever. Entries are **not** removed on read.

**Mistake 2 — Using `LPOP` for jobs you cannot lose.**
Verified: popping removes the entry permanently. A crash loses it.

**Mistake 3 — Writing non-idempotent handlers.**
At-least-once means duplicates. Guard with a `SET NX` or a database unique constraint.

**Mistake 4 — Forgetting `MKSTREAM`.**
`XGROUP CREATE` fails with `no such key` if the stream doesn't exist yet.

**Mistake 5 — Never trimming.**
Streams only grow. Verified: untrimmed it stays at 500. Use `MAXLEN`.

**Mistake 6 — Using `>` on the first read when you want history.**
`>` only gives **undelivered** entries. Use `0` or an ID to replay.

**Mistake 7 — Blocking `XREAD` on your main connection.**
`BLOCK` holds that connection. Use a dedicated client.

**Mistake 8 — Assuming `XAUTOCLAIM` is not needed.**
Without it, a dead consumer's entries sit in `XPENDING` forever.

**Mistake 9 — Creating a new group per deploy.**
Each group sees every entry independently. Reuse the group name.

**Mistake 10 — Assuming `XDEL` is how you finish a job.**
It is not. `XACK` is. `XDEL` physically removes an entry, breaking the log.

**Mistake 11 — Multiple groups thinking they own the job.**
Two groups on one stream = both process everything. That is fan-out, not work-sharing.

---

## 7. Try it yourself

**Exercise:** Build a queue with two consumers. Have consumer A read but **never ack** (simulate
a crash). Then have consumer B run `XAUTOCLAIM` after a 1-second idle timeout and confirm it
recovers A's abandoned entry. Finally ack it and show `XPENDING` drop to zero.

**Hint:** `XREADGROUP GROUP workers A ... STREAMS events '>'`, then skip the `XACK`. Wait 1.1 s.
Then `sendCommand(['XAUTOCLAIM', 'events', 'workers', 'B', '1000', '0'])`.

**What to notice:** the reply's **first element is the next cursor** and the second is the
claimed entries. Verified: `["0-0", [[id, [field, value...]]], []]` — the third element lists
entry IDs that were **deleted** while idle (deleted entries are skipped).

---

## 8. Next

**[Chapter 15 — RedisJSON](15-json.md)** — storing and updating structured documents with
JSONPath, instead of strings you parse and rewrite.

---

**Verified facts recap**

| Claim | How verified |
|---|---|
| `TYPE` of a stream is **`stream`** | Direct |
| IDs are `<ms>-<seq>` | `1791453425124-0` |
| `XREADGROUP ... '>'` gives undelivered entries only | Consumer 2 got `null` |
| `XPENDING` tracks in-flight entries | 2 → 1 after `XACK` |
| `XAUTOCLAIM` steals abandoned work | Claimed the unacked entry |
| `XAUTOCLAIM` reply = `[cursor, entries, deletedIds]` | Direct |
| `XINFO GROUPS` fields are **hyphenated** | `'last-delivered-id'`, `'entries-read'` |
| `XTRIM MAXLEN 1` cut 2 → 1 | Direct |
| `XADD` with `TRIM MAXLEN 100` cut 500 → 100 | Direct |