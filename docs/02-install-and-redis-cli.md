# Chapter 02 — Install and redis-cli

> **Verified on:** Redis **8.10.2**, redis-cli **8.10.2**, container `redis-learn`, port `6379`
> Run the code: `node examples/02-install-and-redis-cli.mjs`

---

## 1. Simple explanation (like I'm 7)

Your Redis is a **program running inside a box** (called a container).

The box is like a tiny computer that never sleeps. Inside it is `redis-cli`, which is a
**telephone** you use to talk to Redis.

- You **type a command** into redis-cli.
- Redis **does that thing** and **prints the answer**.
- It is the same as texting a friend, except the friend replies in 0.1 ms.

redis-cli is how you **look around** the server: how big is it, what's in it, how many
commands does it know, is it healthy.

---

## 2. Real name

### What we started

```bash
docker run -d --name redis-learn -p 6379:6379 redis:latest
```

| Flag | Meaning |
|---|---|
| `-d` | Run in the background (detached), so you get your prompt back |
| `--name redis-learn` | Give the container a name, so you can refer to it later |
| `-p 6379:6379` | Map host port 6379 → container port 6379 |
| `redis:latest` | Use the official Redis image, newest version |

The image already contains the server, `redis-cli`, and the extra modules — which is why
JSON and Search work here for free.

### Talking to it

Because the container is separate, `redis-cli` must be run **inside** it:

```bash
docker exec -it redis-learn redis-cli          # interactive prompt
docker exec redis-learn redis-cli GET mykey   # one-shot command
```

| Prefix | What it does |
|---|---|
| `docker ps` | See running containers |
| `docker exec -it redis-learn redis-cli` | Interactive shell |
| `docker exec redis-learn redis-cli ...` | Run one command, print output |
| `docker stop redis-learn` | Stop the container |
| `docker start redis-learn` | Start it again |
| `docker rm redis-learn` | Delete it (data goes too) |

### `redis-cli` flags worth knowing

| Flag | Meaning |
|---|---|
| `-n <0-15>` | Use a different logical database |
| `--no-raw` | Print numbers/quotes plainly instead of escaped |
| `--scan` | Safely list keys using `SCAN` (see [Chapter 04](04-keys-and-naming.md)) |
| `--bigkeys` | Find keys using unusually large memory |
| `--latency` | Continuously measure round-trip latency |
| `--version` | Print the client version |

---

## 3. redis-cli example

### Start an interactive session

```bash
docker exec -it redis-learn redis-cli
```

```redis
127.0.0.1:6379> PING
PONG
127.0.0.1:6379> SET ch02:demo "hello"
OK
127.0.0.1:6379> GET ch02:demo
"hello"
127.0.0.1:6379> DBSIZE
(integer) 1
127.0.0.1:6379> DEL ch02:demo
(integer) 1
127.0.0.1:6379> DBSIZE
(integer) 0
```

### Ask the server about itself

```bash
docker exec redis-learn redis-cli COMMAND COUNT
```
```redis
(integer) 447
```

```bash
docker exec redis-learn redis-cli MODULE LIST
```
```redis
1) 1) "name"
   2) "vectorset"
   3) "ver"
   4) (integer) 1
   ...
2) 1) "name"
   2) "bf"
   ...
5) 1) "name"
   2) "ReJSON"
   3) "ver"
   4) (integer) 81000
```

The five modules are `vectorset`, `bf` (Bloom), `timeseries`, `search` (RediSearch), and
`ReJSON`. **The last two are why [Chapters 15](15-json.md) and [16](16-search.md) are real
tutorials and not theory.**

### `COMMAND DOCS` — the server explains itself

This is the single most useful command for learning. It works on **your** server, so it is
never out of date:

```bash
docker exec redis-learn redis-cli COMMAND DOCS KEYS
```
```redis
keys
summary
Returns all key names that match a pattern.
since
1.0.0
group
generic
complexity
O(N) with N being the number of keys in the database, under the assumption that the key names in the database and the given pattern have limited length.
arguments
name
pattern
type
pattern
display_text
pattern
```

**Read that `complexity` line every time.** It tells you whether a command is safe. `GET`
is `O(1)`. `KEYS` is `O(N)`. That single word is the difference between a fast server and a
frozen one.

```bash
docker exec redis-learn redis-cli COMMAND DOCS HGETALL   # O(N) where N is the size of the hash
docker exec redis-learn redis-cli COMMAND DOCS SMEMBERS  # O(N) where N is the set cardinality
```

### Look at the configuration

```bash
docker exec redis-learn redis-cli CONFIG GET maxmemory
docker exec redis-learn redis-cli CONFIG GET appendonly
docker exec redis-learn redis-cli CONFIG GET databases
```
```redis
1) "maxmemory"
2) "0"
1) "appendonly"
2) "no"
1) "databases"
2) (integer) 16
```

`maxmemory` is `0` = **no limit**. Remember this — it is one of the top production
mistakes ([Chapter 22](22-memory-and-eviction.md)).

### Inspecting memory and keys safely

```bash
docker exec redis-learn redis-cli INFO memory | head -5
docker exec redis-learn redis-cli --scan --pattern 'ch02:*'     # safe listing, not KEYS
docker exec redis-learn redis-cli MEMORY USAGE somekey
docker exec redis-learn redis-cli OBJECT ENCODING somekey
```

---

## 4. Node.js example

The same inspection, from Node.js.

```javascript
// examples/02-install-and-redis-cli.mjs
import { createClient } from 'redis';

const client = createClient({ url: 'redis://127.0.0.1:6379' });
await client.connect();

// --- Where am I connected? -----------------------------------------------
const info = await client.info('server');                     // same as INFO server
const pick = (s, re) => s.match(re)?.[1] ?? '(not found)';
console.log('version      :', pick(info, /redis_version:(\S+)/));
console.log('mode         :', pick(info, /redis_mode:(\S+)/));
console.log('port         :', pick(info, /tcp_port:(\S+)/));

// --- How many commands does this server know? ----------------------------
console.log('commands     :', await client.commandCount());

// --- Which modules (extra features) are loaded? --------------------------
const mods = await client.sendCommand(['MODULE', 'LIST']);    // array of objects
console.log('modules      :', mods.map(m => `${m.name} (v${m.ver})`).join(', '));

// --- Settings are just key/value config ----------------------------------
console.log('maxmemory    :', (await client.configGet('maxmemory')).maxmemory, '(0 = unlimited)');
console.log('appendonly   :', (await client.configGet('appendonly')).appendonly);

// --- Which wire protocol are we speaking? --------------------------------
const ci = await client.sendCommand(['CLIENT', 'INFO']);
console.log('resp version :', ci.match(/resp=(\d+)/)[1]);

await client.close();
```

### Verified output

```
version      : 8.10.2
mode         : standalone
port         : 6379
os / arch    : Linux / 64
uptime (days): 0
commands     : 447
modules      : vectorset (v1), bf (v81001), timeseries (v81001), search (v81001), ReJSON (v81000)
databases    : 16
maxmemory    : 0 (0 = unlimited)
save policy  : 3600 1 300 100 60 10000
appendonly   : no
resp version : 3
lib          : node-redis 6.3.0
dbsize       : 0
GET  -> Returns the string value of a key. | O(1) | since 1.0.0
KEYS -> Returns all key names that match a pattern. | O(N) with N being the number of keys in the database, under the assumption that the key names in the database and the given pattern have limited length.
       ^ O(N) over the whole database. Do not run this in production.
SMEMBERS -> O(N) where N is the set cardinality. | Returns all members of a set.
```

### Two things to notice

1. **`resp version : 3`** — node-redis 6 speaks **RESP3** by default. That is why
   `MODULE LIST` and `COMMAND DOCS` come back as **structured objects** instead of flat
   arrays. If you follow an old tutorial that expects flat arrays, this is why it looks
   different.

2. **`sendCommand()`** is the escape hatch. `info()`, `dbSize()`, `configGet()` are all
   real methods, but `MODULE LIST` and `COMMAND DOCS` are not — so you call them as raw
   commands:

   ```javascript
   await client.sendCommand(['COMMAND', 'DOCS', 'GET']);
   // { get: { summary: 'Returns the string value of a key.', since: '1.0.0',
   //          group: 'string', complexity: 'O(1)', arguments: [...] } }
   ```

   The reply is keyed by the lower-cased command name. For commands with a version
   history, the value is an **array** — take `[0]`.

---

## 5. When to use it and when NOT to

### ✅ Use redis-cli when

- You are **learning** and want to see exactly what the server does.
- You are **debugging** in production (see [Chapter 27](27-monitoring-and-debugging.md)).
- You want to **inspect memory, keys, config, or slow queries** by hand.
- You are writing a **health check** or **cron job** that inspects the server.

### ❌ Don't use redis-cli when

| Situation | Why | Use instead |
|---|---|---|
| Application code | No connection pooling, no retries, no error handling | node-redis ([Chapter 03](03-nodejs-client-setup.md)) |
| Automated deployment | You cannot paste commands into a container | A config file (e.g. `redis.conf`) |
| Listing every key on a big database | `KEYS` blocks the server | `SCAN` / `redis-cli --scan` |
| Anything destructive by accident | `FLUSHALL` wipes the database instantly | `SCAN` + explicit `DEL` |

### If you did not have Docker

You told me to use Docker and it worked, so this is just a fallback note.

| OS | Best option |
|---|---|
| **Ubuntu / Debian** | `sudo apt install redis-server`, then `sudo systemctl start redis-server` |
| **macOS** | `brew install redis` then `brew services start redis` |
| **Windows** | Use the Memurai service, or WSL2 + the Ubuntu instructions |
| **Any OS, no admin rights** | Download and compile from source, or use a managed cloud instance |

On Ubuntu you can also run Redis without installing a service:

```bash
sudo apt install redis-server
redis-server --port 6379 --daemonize yes
```

Docker is still the better choice for learning because it gives you a clean, throwaway
server that always matches the documented version.

---

## 6. Common mistakes

**Mistake 1 — Running `redis-cli` on the host instead of inside the container.**

```bash
redis-cli PING            # ✗ command not found / connection refused
docker exec redis-learn redis-cli PING    # ✓ PONG
```

**Mistake 2 — Thinking `-p 6379:6379` means two servers.** It means the host's 6379 is
tunneled to the container's 6379. One server, two addresses.

**Mistake 3 — Running `KEYS *` out of curiosity on a large database.**
It returns everything into your terminal **and blocks Redis** while it works. Use
`redis-cli --scan` or `SCAN` ([Chapter 04](04-keys-and-naming.md)).

**Mistake 4 — `FLUSHALL` when you meant `FLUSHDB`.**
`FLUSHALL` wipes **every** database (all 16). `FLUSHDB` wipes only the current one. There
is no undo.

**Mistake 5 — Quoting problems.** redis-cli is a shell tool first:

```bash
docker exec redis-learn redis-cli SET mykey "hello world"   # ✓ value is "hello world"
```

For keys/values with spaces or quotes, prefer `--no-raw` for readability, or use
`redis-cli` interactively so you can see exactly what is stored.

**Mistake 6 — Believing `redis-cli --version` tells you the server version.** It only tells
you the CLI version. For the server use `INFO server` or `redis-server --version`.

**Mistake 7 — Changing config with `CONFIG SET` and expecting it to survive a restart.**
`CONFIG SET` changes the running server only. You must also `CONFIG REWRITE` to write it to
the config file — and in a Docker container with no config file, it is lost on restart.
**Configuration belongs in a config file or env vars you control**, not typed by hand.

**Mistake 8 — Opening 16 databases and assuming it isolates you.**
`SELECT 1` gives a separate namespace, but `maxmemory` and memory are **shared** across all
16, and `FLUSHALL` hits all of them. Many teams use only database 0.

---

## 7. Try it yourself

**Exercise:** Using only redis-cli, find out (a) the server's version, (b) how many
databases it has, (c) whether AOF is enabled, and (d) the documented complexity of
`HGETALL`.

**Hint:** `INFO server`, `CONFIG GET <name>`, and `COMMAND DOCS <command>`. For (d), look
at the `complexity` line in the output — remember the server's own docs are the truth.

**Stretch:** Set a value, then use `OBJECT ENCODING` on it. Then set it to a number instead
and check again — the internal encoding changes (`embstr` vs `int`), which is your first
hint that Redis is optimised around how you use it.

---

## 8. Next

**[Chapter 03 — Connect from Node.js](03-nodejs-client-setup.md)** — installing the client,
connecting properly, handling errors, and the `close()` vs `quit()` trap.

---

**Verified facts recap**

| Claim | How verified |
|---|---|
| Redis 8.10.2, standalone, port 6379 | `INFO server` |
| 447 commands | `COMMAND COUNT` |
| 5 modules incl. search + ReJSON | `MODULE LIST` |
| `databases` = 16 | `CONFIG GET databases` |
| `maxmemory` = 0 (unlimited) | `CONFIG GET maxmemory` |
| `appendonly` = no | `CONFIG GET appendonly` |
| RESP3 in use | `CLIENT INFO` → `resp=3` |
| node-redis 6.3.0 | `CLIENT INFO` → `lib-ver=6.3.0` |
| `GET` = O(1), `KEYS` = O(N), `SMEMBERS` = O(N), `HGETALL` = O(N) | `COMMAND DOCS` |