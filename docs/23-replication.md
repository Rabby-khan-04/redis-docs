# Chapter 23 — Replication

> **Verified on:** Redis **8.10.2**, node-redis **6.3.0**
> Run the code: `node examples/23-replication.mjs`
> Infra: a second container `redis-replica` (port 6381) replicating from `redis-learn` (port 6379)

---

## 1. Simple explanation (like I'm 7)

You have **one** teacher who knows everything (the primary). You also have one or more
**helpers** (replicas) who copy everything the teacher writes, almost instantly.

- If you ask a question, the teacher answers (the primary handles writes).
- If the teacher is busy, a helper can answer reads for you (replicas serve reads).
- If the teacher gets sick, a helper can be promoted to teacher (failover).

The catch: the copying is **not instant**. A helper might be a few milliseconds behind.

---

## 2. Real name

**Replication** = one **primary** node accepts writes; one or more **replicas** copy the
primary's data stream asynchronously.

### Commands

| Command | What it does |
|---|---|
| `REPLICAOF host port` | Make this node a replica of `host:port` |
| `REPLICAOF NO ONE` | Promote this replica to a primary |
| `SLAVEOF` | Deprecated alias of `REPLICAOF` |
| `INFO replication` | Role, offset, lag, connected slaves |
| `WAIT numreplicas timeout` | Block until N replicas have the write |
| `PSYNC` | Internal: partial/full resync |

### Verified on this setup

```
primary role  -> master
replica role  -> slave
primary connected_slaves -> 1
replica master_host     -> 172.22.0.2
replica master_link_status -> up
```

---

## 3. redis-cli example

```bash
# Primary (redis-learn, port 6379) and replica (redis-replica, port 6381)
docker exec redis-replica redis-cli INFO replication | grep -E "role:|master_host:|master_link_status:"
```

```
role:slave
master_host:172.22.0.2
master_link_status:up
```

### Write on primary, read on replica

```redis
# Primary:
127.0.0.1:6379> SET msg "hello from primary"
OK
# Replica (after a moment):
127.0.0.1:6381> GET msg
"hello from primary"
```

Verified in code: primary `SET` then replica `GET` returns the value after a 200 ms wait.

### Replica is read-only

```redis
127.0.0.1:6381> SET x "no"
(error) READONLY You can't write against a read only replica.
```

Verified: `replica_read_only config -> yes`.

### Promotion

```redis
127.0.0.1:6381> REPLICAOF NO ONE
OK
127.0.0.1:6381> INFO replication
role:master
```

---

## 4. Node.js example

### Verified output of `examples/23-replication.mjs`

```
--- roles ---
primary role  -> master
replica role  -> slave
primary connected_slaves -> 1
replica master_host     -> 172.22.0.2
replica master_link_status -> up

--- write -> replicate ---
primary SET -> hello from primary
replica GET -> hello from primary   (replicated)

--- replica rejects writes ---
replica SET -> READONLY You can't write against a read only replica.
  ^ READONLY You can't write against a read only replica.
replica_read_only config -> yes

--- replication lag ---
primary master_repl_offset -> 131
wrote 1000 keys on primary
replica master_repl_offset -> 41911
replica slave_repl_offset  -> 41911
  ^ the two offsets match when the replica is caught up

--- ⚠️ async replication and data loss ---
Replication is ASYNCHRONOUS: a write returns OK before the replica has it.
If the primary crashes in that window, the write is LOST.
WAIT 1 1000 -> 1 (1 = replica has it, 0 = timed out)

--- PSYNC (partial resync) ---
On reconnect, the replica asks the primary: "do you still have my backlog?"
  if yes -> partial resync (fast, no full snapshot)
  if no  -> full resync (slow, dumps the whole DB)
The backlog size is `repl-backlog-size` (default 1 MB).
repl_backlog_size -> 1048576

--- read scaling ---
replica GET -> hello from primary   (you can read from replicas to scale reads)
  ^ but replication is async, so a read might be stale by a few ms

DBSIZE primary after cleanup: 0
```

### The offsets — how lag is measured

```javascript
const primaryOffset = (await primary.info('replication')).match(/master_repl_offset:(\d+)/)[1];
const replicaOffset = (await replica.info('replication')).match(/slave_repl_offset:(\d+)/)[1];
const lag = primaryOffset - replicaOffset;   // 0 when caught up
```

Verified: after writing 1,000 keys and waiting 500 ms, both offsets were **41911**.

### `WAIT` — synchronous-ish writes

```javascript
await primary.set('important', 'value');
const n = await primary.sendCommand(['WAIT', '1', '1000']);
// 1 = replica has it, 0 = timed out (1000ms)
```

Verified: `WAIT 1 1000 -> 1`. Use this for writes you cannot afford to lose.

### PSYNC (partial resync)

When a replica reconnects, it asks the primary: *"do you still have my backlog?"*

- **Yes** → **partial resync** (fast, streams the gap).
- **No** (backlog evicted) → **full resync** (slow, dumps the whole database).

The backlog size is `repl-backlog-size` (default 1 MB). For a busy primary, raise it.

---

## 5. When to use it and when NOT to

### ✅ Use replication when

- You want **read scaling** (offload reads to replicas).
- You want a **hot standby** for failover.
- You want **geographic distribution** of reads.
- You want a **backup** you can promote quickly.

### ❌ Don't use it when

| Situation | Why | Use instead |
|---|---|---|
| You need **zero data loss** | Async: a write can be lost | `WAIT`, or a real DB |
| You need **automatic failover** | Replication alone doesn't fail over | [Sentinel](24-sentinel.md) or [Cluster](25-cluster.md) |
| You need **strong consistency** | Replica reads are stale | Read from the primary |
| You need **write scaling** | One primary only | [Cluster](25-cluster.md) |
| You have **many replicas** on a slow link | Full resyncs are expensive | Raise `repl-backlog-size` |

### 🔴 The data-loss window

A write returns `OK` **before** the replica has it. If the primary crashes in that window,
the write is lost.

```
client: SET x 1 → OK (primary has it, replica does not yet)
primary crashes
replica is promoted
GET x → nil (the write is gone)
```

Mitigations: `WAIT`, AOF on the primary, or accept the loss.

---

## 6. Common mistakes

**Mistake 1 — Reading from a replica expecting strong consistency.**
Replica reads are **stale by a few milliseconds**. Use the primary for reads that must be
up-to-date.

**Mistake 2 — Assuming replication is synchronous.**
It is **asynchronous**. Verified: the offsets lagged briefly during a burst of 1,000 writes.

**Mistake 3 — Not setting `repl-backlog-size` high enough.**
A short backlog means frequent **full resyncs** on reconnect, which dump the whole DB.

**Mistake 4 — Running `SAVE` on a replica.**
A replica can save, but it is usually unnecessary and wastes I/O.

**Mistake 5 — Evicting on a replica.**
Replicas run the same eviction policy. If a replica evicts, the data is gone there.

**Mistake 6 — Not monitoring `master_link_status`.**
`down` means the replica is not receiving updates. Alert on it.

**Mistake 7 — Assuming `REPLICAOF NO ONE` is instant.**
It promotes the replica, but existing clients on the old primary are not redirected.

**Mistake 8 — Forgetting that `SLAVEOF` is deprecated.**
Use `REPLICAOF`.

**Mistake 9 — Cross-datacenter replication without a plan.**
Latency between regions means larger lag. Use `WAIT` sparingly.

**Mistake 10 — Not testing failover.**
A replica you have never promoted is not a standby. Test it.

---

## 7. Try it yourself

**Exercise:** Write 10 keys to the primary, read them from the replica, then run
`REPLICAOF NO ONE` on the replica and confirm it becomes writable. Then point it back at
the primary and confirm it re-syncs (full resync, since the backlog may be gone).

**Hint:** `REPLICAOF NO ONE`, then `INFO replication` shows `role:master`. Then
`REPLICAOF <primary-ip> 6379` to re-sync.

**What to notice:** after re-syncing, the replica's `master_repl_offset` starts from 0 and
catches up. If the primary kept writing during the gap, the replica gets a full resync.

**Stretch:** measure the lag under load by writing 100,000 keys and reading
`slave_repl_offset` during the write.

---

## 8. Next

**[Chapter 24 — Sentinel](24-sentinel.md)** — automatic failover when the primary dies.

---

**Verified facts recap**

| Claim | How verified |
|---|---|
| Primary role `master`, replica role `slave` | `INFO replication` |
| `connected_slaves:1` on primary | Direct |
| `master_link_status:up` | Direct |
| Write on primary → replica GET returns it | 200 ms wait |
| Replica `SET` → `READONLY` | Direct |
| `replica_read_only` = `yes` | `CONFIG GET` |
| Offsets match after 1,000 writes | 131 → 41911 both |
| `WAIT 1 1000` → `1` | Direct |
| `repl-backlog-size` = 1 MB | `CONFIG GET` |
| `SLAVEOF` deprecated | `REPLICAOF` is the modern name |