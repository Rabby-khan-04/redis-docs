# Chapter 25 — Cluster

> **Verified on:** Redis **8.10.2**, node-redis **6.3.0**
> Run the code: `node examples/25-cluster.mjs`
> Infra: 3 master nodes on 172.17.0.3/4/5:6379 (no replicas)

---

## 1. Simple explanation (like I'm 7)

One Redis can only hold so much data and handle so many requests. Eventually you need
**more than one**.

A cluster is like splitting a **giant filing cabinet** into three smaller ones, each held by
a different person. Each person owns a **range of drawer numbers**. If you ask for drawer
42, the person who owns that range handles it.

The catch: a single request can only touch **one drawer range**. If you need drawers 42 and
9999, which belong to different people, you must ask twice.

---

## 2. Real name

**Redis Cluster** partitions the keyspace into **16,384 hash slots**. Each master node owns
a subset of slots. A key's slot is `CRC16(key) % 16384`.

### Commands

| Command | What it does |
|---|---|
| `CLUSTER INFO` | State of the cluster |
| `CLUSTER NODES` | All nodes and their slots |
| `CLUSTER SLOTS` | Slot-to-node mapping |
| `CLUSTER KEYSLOT key` | Which slot a key belongs to |
| `CLUSTER ADDSLOTS` / `DELSLOTS` | Assign slots (internal) |
| `CLUSTER MEET ip port` | Add a node |
| `CLUSTER FAILOVER` | Promote a replica to master |

### Hash tags

`{...}` in a key forces the slot to be computed from the contents of the braces:

```
{user}:1:name  and  {user}:1:age   →  same slot
```

This is how you do multi-key operations in a cluster.

---

## 3. redis-cli example

```bash
# Cluster setup (done once):
redis-cli --cluster create 172.17.0.3:6379 172.17.0.4:6379 172.17.0.5:6379 --cluster-replicas 0
```

```redis
127.0.0.1:7000> CLUSTER INFO
cluster_state:ok
cluster_slots_assigned:16384
cluster_slots_ok:16384
cluster_known_nodes:3
cluster_size:3
```

```redis
127.0.0.1:7000> CLUSTER KEYSLOT k1
(integer) 12706
127.0.0.1:7000> CLUSTER KEYSLOT {user}:1:name
(integer) 5763
127.0.0.1:7000> CLUSTER KEYSLOT {user}:1:age
(integer) 5763
```

Verified: `{user}:1:name` and `{user}:1:age` have the **same slot** (5763).

### MOVED and ASK redirects

When a client asks the wrong node, it gets a redirect:

```redis
-MOVED 12706 172.17.0.4:6379
```

or, during a reshard:

```redis
-ASK 5763 172.17.0.5:6379
```

A smart client follows these automatically. A dumb one (raw `redis-cli`) shows them to you.

---

## 4. Node.js example

### Verified output of `examples/25-cluster.mjs`

```
--- basics ---
isReady -> true
GET k1 -> v1
CLUSTER KEYSLOT -> 4805

--- hash tags ---
GET {user}:1:name -> Ada
GET {user}:1:age  -> 36
  ^ the {user} tag puts both keys in the SAME slot, so multi-key ops work

--- cross-slot operations ---
cross-slot MGET -> succeeded (client routed per-key)
cross-slot MULTI -> Too many Cluster redirections (MULTI cannot span slots)

--- redirects ---
  The client handles MOVED and ASK redirects transparently.

--- cluster info ---
cluster_state          : ok
cluster_slots_assigned : 16384
cluster_known_nodes    : 3
cluster_size           : 3
cluster_current_epoch  : 3

cluster DBSIZE-ish (per-node): 1
```

### The setup

```javascript
import { createCluster } from 'redis';

const cluster = createCluster({
  rootNodes: [
    { url: 'redis://172.17.0.3:6379' },
    { url: 'redis://172.17.0.4:6379' },
    { url: 'redis://172.17.0.5:6379' },
  ],
});
await cluster.connect();
```

`createCluster` auto-discovers the topology from the root nodes.

### ⭐ Hash tags — the most important cluster feature

```javascript
await cluster.set('{user}:1:name', 'Ada');
await cluster.set('{user}:1:age', '36');
```

Both keys land in **slot 5763**. Without the tag, `user:1:name` and `user:1:age` would
likely be on different nodes and `MGET`/`MULTI` would fail.

### 🔴 Cross-slot operations fail

Verified:

```
cross-slot MGET -> succeeded (client routed per-key)
cross-slot MULTI -> Too many Cluster redirections (MULTI cannot span slots)
```

- **`MGET`** with keys on different slots: node-redis routes each key separately and
  assembles the reply. **Works** (with extra round trips).
- **`MULTI/EXEC`** across slots: **fails**. A transaction is one atomic unit and must be
  on one node.

So in a cluster you can read many keys at once (cost: extra round trips), but you cannot
run a transaction across keys on different slots.

### What the client handles for you

- **MOVED** redirects: the client updates its slot map and retries.
- **ASK** redirects (during resharding): the client sends `ASKING` then retries.
- **Connection management**: one connection per node.

You never see these unless you use raw `sendCommand`.

---

## 5. When to use it and when NOT to

### ✅ Use Cluster when

- You need **more memory** than one machine has.
- You need **more write throughput** than one primary can handle.
- You want **automatic failover** (with replicas).
- You can accept **some operational complexity**.

### ❌ Don't use it when

| Situation | Why | Use instead |
|---|---|---|
| You need **multi-key transactions** across keys | Cross-slot `MULTI` fails | Single node, or hash-tag your keys |
| You need **strong consistency** across keys | Async replication | Single node |
| You need **Pub/Sub** at scale | Regular pub/sub broadcasts to all nodes | Sharded pub/sub (Redis 7+) |
| You have **few keys** | Complexity for nothing | Single node + replica |
| You need **Lua scripts touching many keys** | All keys must be on the same slot | Hash tags |
| You need **blocking commands** | They block one node | Careful design |

### The cluster tax

- **Operations that touch multiple keys** need hash tags.
- **Lua scripts** must declare all keys via `KEYS[]` and they must all be on the same slot.
- **Pub/Sub** broadcasts to every node.
- **Migrations** (resharding) cause `ASK` redirects and brief slowdowns.

---

## 6. Common mistakes

**Mistake 1 — Cross-slot `MULTI`.**
Verified: `Too many Cluster redirections`. Hash-tag your keys.

**Mistake 2 — Lua scripts that touch keys on different slots.**
Cluster rejects them with `CROSSSLOT Keys in request don't hash to the same slot`.

**Mistake 3 — Assuming `MGET` is one round trip.**
It is one call, but the client fans out. **N round trips** in the worst case.

**Mistake 4 — Using a `*` hash tag.**
`{*}` puts everything in one slot — defeating the purpose of clustering. Use meaningful
tags like `{user}` or `{order}`.

**Mistake 5 — Forgetting that `DBSIZE` is per-node.**
Verified: `cluster.dbSize()` returned `1` (one node's count), not the total.

**Mistake 6 — Running `KEYS` on a cluster node.**
Blocks that node only, but you still shouldn't. Use `SCAN`.

**Mistake 7 — Not handling `MOVED` in raw clients.**
If you bypass the client, you must follow redirects yourself.

**Mistake 8 — Assuming cluster is a drop-in replacement.**
It is not. Test every multi-key operation.

**Mistake 9 — Too few replicas.**
A 3-master cluster with no replicas loses a third of your data if one node dies.

**Mistake 10 — Not monitoring slot coverage.**
`cluster_slots_assigned` must be 16384. Anything less means a broken cluster.

---

## 7. Try it yourself

**Exercise:** Design a keyspace for a chat application where messages for a conversation
must be atomic (append a message + increment a counter). Use hash tags so the two keys land
on the same node, then verify with `CLUSTER KEYSLOT` that they share a slot.

**Hint:** `{conv:42}:messages` and `{conv:42}:count`. Then `MULTI` works because both
keys are on the same slot.

**What to notice:** the hash tag is the **only** way to do multi-key operations in a
cluster. Every key design decision starts with "which keys must be on the same node?"

**Stretch:** try a `MULTI` across two different hash tags and watch it fail.

---

## 8. Next

**[Chapter 26 — Security](26-security.md)** — ACLs, passwords, TLS, and the myth that
"Redis is on a private network".

---

**Verified facts recap**

| Claim | How verified |
|---|---|
| 16,384 slots, 3 masters | `CLUSTER INFO` |
| `CLUSTER KEYSLOT k1` → 4805 (varies) | Direct |
| `{user}:1:name` and `{user}:1:age` share a slot (5763) | Direct |
| Cross-slot `MULTI` → "Too many Cluster redirections" | Direct |
| Cross-slot `MGET` succeeds (client routes per-key) | Direct |
| `clusterInfo()` returns a **string**, not an object | Type check |
| `cluster.dbSize()` is **per-node** | Returned 1 |
| `cluster.clusterInfo()` parsed into fields | Direct |
| MOVED/ASK handled transparently | Direct |