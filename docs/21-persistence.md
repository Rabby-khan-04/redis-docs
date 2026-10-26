# Chapter 21 — Persistence: RDB and AOF

> **Verified on:** Redis **8.10.2**
> Run the code: `node examples/21-persistence.mjs`

---

## 1. Simple explanation (like I'm 7)

Redis lives in **RAM**. RAM is like a whiteboard: fast, but wiped when the power goes out.

Persistence is the **backup plan**. Two options:

- **RDB** = a **photograph** of the whole database, taken every so often. Fast to take and
  fast to restore, but you can lose the last few minutes.
- **AOF** = write down **every change** as it happens. Almost nothing is lost, but the file
  grows and restore is slower.

You can use both. Most production setups do.

---

## 2. Real name

| | RDB (snapshot) | AOF (append-only file) |
|---|---|---|
| What it writes | A compact binary dump | Every command that changed data |
| When | Every N seconds (configurable) | Every 1 second by default |
| Data loss on crash | Up to the last snapshot | Up to the last second |
| Restore speed | **Fast** (one binary load) | Slower (replay commands) |
| File size | **Small** | Larger, but auto-compacted |
| Best for | Backups, replicas, fast restarts | Maximum durability |

### What is on by default here?

Verified:

```
appendonly (AOF) -> no
save (RDB triggers) -> 3600 1 300 100 60 10000
```

On this server: **RDB only**, with the default save policy.

### RDB save policy

```
save 3600 1 300 100 60 10000
```

Means: save if **(3600 s AND ≥1 change)** OR **(300 s AND ≥100 changes)** OR
**(60 s AND ≥10000 changes)**. A busy server saves every minute; an idle one every hour.

### AOF fsync policies

| `appendfsync` | Behaviour | Durability |
|---|---|---|
| `always` | fsync after every command | slow, no data loss |
| `everysec` (default) | fsync once per second | up to 1 s of loss |
| `no` | OS decides | up to ~30 s of loss, fast |

---

## 3. redis-cli example

```bash
docker exec -it redis-learn redis-cli
```

### Inspect persistence

```redis
127.0.0.1:6379> INFO persistence
# Persistence
rdb_changes_since_last_save:0
rdb_last_bgsave_status:ok
rdb_last_save_time:1793001061
aof_enabled:0
aof_rewrite_in_progress:0
```

### Force a save

```redis
127.0.0.1:6379> BGSAVE
Background saving started
127.0.0.1:6379> LASTSAVE
(integer) 1793001061
```

- `BGSAVE` — fork a child, save in the background (server keeps serving).
- `SAVE` — save on the main thread (blocks everything — never in production).

### Turn on AOF at runtime

```redis
127.0.0.1:6379> CONFIG SET appendonly yes
OK
127.0.0.1:6379> INFO persistence
aof_enabled:1
127.0.0.1:6379> CONFIG SET appendonly no
OK
```

⚠️ **Runtime-only.** On restart, AOF is off again unless the config file has
`appendonly yes`.

### AOF rewrite

```redis
127.0.0.1:6379> BGREWRITEAOF
Background append only file rewriting started
```

The AOF grows forever (every `INCR` is a line). `BGREWRITEAOF` rebuilds it into a compact
snapshot. Runs automatically when the file has grown by `auto-aof-rewrite-percentage`
(100 = doubled) and is at least `auto-aof-rewrite-min-size` (64 MB).

---

## 4. Node.js example

### Verified output of `examples/21-persistence.mjs`

```
--- what is on? ---
appendonly (AOF) -> no   (no = RDB-only on this server)
save (RDB triggers) -> 3600 1 300 100 60 10000
  -> 3600 1 300 100 60 10000 means:
     after 3600s if 1 change, OR 300s if 100 changes, OR 60s if 10000 changes

key persistence stats:
  rdb_changes_since_last_save:0
  rdb_last_bgsave_status:ok
  rdb_last_save_time:1793001061
  aof_enabled:0
  aof_rewrite_in_progress:0

--- manual save ---
BGSAVE -> Background saving started
rdb_last_bgsave_status -> rdb_last_bgsave_status:ok
rdb_last_save_time    -> rdb_last_save_time:1793001061
LASTSAVE -> 1793001061

--- AOF ---
CONFIG SET appendonly yes -> OK
aof_enabled now -> aof_enabled:1
restored appendonly=no

--- config persistence ---
CONFIG SET changes the running server only.
CONFIG REWRITE writes it to the config file (if one exists).
In a Docker container with no config file, REWRITE has nowhere to go.
Real config belongs in a mounted redis.conf or env vars.

--- fork / COW ---
BGSAVE forks a child process. The child writes the RDB while the parent keeps running.
The fork uses copy-on-write: memory is shared until a page changes.
A big write load during a save can double memory briefly (current_cow_peak).
current_cow_peak -> current_cow_peak:0

--- AOF rewrite ---
BGREWRITEAOF -> Background append only file rewriting started
aof_last_bgrewrite_status -> ok
aof_rewrite_in_progress  -> 0

DBSIZE after cleanup: 0
```

### The API

```javascript
await client.bgSave();              // BGSAVE (non-blocking)
await client.save();                // SAVE (blocking, avoid in production)
const ts = await client.lastSave(); // unix timestamp of last save
const info = await client.info('persistence');

await client.configSet('appendonly', 'yes');
await client.configRewrite();       // writes to the config file
await client.bgRewriteAof();
```

### Fork + copy-on-write

`BGSAVE` forks a child process. The parent keeps serving; the child writes the file.

The fork uses **copy-on-write**: pages are shared until one side writes. A large write
load *during* a save can briefly double memory usage. Watch `current_cow_peak` in
`INFO persistence` — if it approaches `maxmemory`, the save itself can trigger an OOM.

---

## 5. When to use it and when NOT to

### ✅ Use RDB when

- You want **fast restarts**.
- You want a **compact backup** to ship to S3.
- You can tolerate losing **minutes** of data.
- You need a **replica** to bootstrap.

### ✅ Use AOF when

- You **cannot lose more than one second** of data.
- You need **crash recovery** to the exact last second.
- You write to Redis as a **primary store**.

### ✅ Use both when

- You want RDB for **backups/replicas** and AOF for **durability**.
- You want the fast RDB restore *plus* the AOF safety net.

### ❌ Don't use when

| Situation | Why | Fix |
|---|---|---|
| You treat Redis as a pure cache | Persistence costs CPU/IO | Disable both, set `save ""` |
| You need **zero data loss** | Even AOF loses the last second | Use a real database |
| You run on a **tiny disk** | AOF can grow large | Enable rewrite, monitor size |
| You fsync `always` under high load | Disk becomes the bottleneck | Use `everysec` |

### The classic production mistake

"Redis is on, but we have no persistence configured." Then the server restarts and
**everything is gone**. Verified: this container ships with `appendonly: no` and a save
policy that only fires every hour if one change happens. A restart loses up to an hour of
data by default.

---

## 6. Common mistakes

**Mistake 1 — Thinking `CONFIG SET` survives a restart.**
Verified: it does not. Use `CONFIG REWRITE` plus a mounted config file.

**Mistake 2 — `SAVE` in production.**
Blocks the server. Always `BGSAVE`.

**Mistake 3 — Forgetting persistence is **off** by default in some images.**
Always check `INFO persistence` after deploying.

**Mistake 4 — AOF on a busy write-heavy server without rewrite.**
The file grows without bound. Monitor `aof_rewrite_in_progress` and the file size.

**Mistake 5 — RDB `save` policy too loose.**
`3600 1` means up to an hour of loss. Tighten for real data.

**Mistake 6 — AOF + RDB both on, both writing to the same disk.**
I/O contention during saves. Put them on different volumes.

**Mistake 7 — Not testing restore.**
A backup you have never restored is not a backup. Test it.

**Mistake 8 — Assuming AOF replays forever after a crash.**
If the server died mid-write, the AOF tail may be corrupt. Redis truncates it on load by
default (`aof-load-truncated yes`).

**Mistake 9 — `appendfsync always` on a slow disk.**
Verified default is `everysec`. Don't change without measuring.

**Mistake 10 — RDB file on a volume that gets wiped.**
The RDB is only as safe as the disk it lives on.

---

## 7. Try it yourself

**Exercise:** Set 10 keys, run `BGSAVE`, then **stop the container** (`docker stop
redis-learn`), start it again (`docker start redis-learn`), and confirm the 10 keys are
still there. Then repeat without `BGSAVE` and observe the data is gone.

**Hint:** `docker stop`, `docker start`, then `redis-cli DBSIZE`. Use `BGSAVE` and
`LASTSAVE` to confirm the save completed.

**What to notice:** RDB restore is **fast** because it is one binary load, not a replay.

**Stretch:** turn on AOF with `CONFIG SET appendonly yes`, write 10 keys, restart the
container, and confirm they survive. Then set `appendonly no` again.

---

## 8. Next

**[Chapter 22 — Memory and eviction](22-memory-and-eviction.md)** — what happens when Redis
runs out of RAM, and the 8 eviction policies.

---

**Verified facts recap**

| Claim | How verified |
|---|---|
| `appendonly` is `no` by default | `CONFIG GET appendonly` |
| `save` policy = `3600 1 300 100 60 10000` | `CONFIG GET save` |
| `appendfsync` = `everysec` | `CONFIG GET appendfsync` |
| `auto-aof-rewrite-percentage` = 100 | Direct |
| `auto-aof-rewrite-min-size` = 64 MB | Direct |
| `CONFIG SET appendonly yes` flips `aof_enabled` | Verified |
| `BGSAVE` returns `Background saving started` | Direct |
| `BGREWRITEAOF` returns `Background append only file rewriting started` | Direct |
| No config file in the container | `config_file:` empty in `INFO server` |
| `current_cow_peak` = 0 | Direct |