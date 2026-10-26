# Chapter 26 — Security

> **Verified on:** Redis **8.10.2**, node-redis **6.3.0**
> Run the code: `node examples/26-security.mjs`

---

## 1. Simple explanation (like I'm 7)

Redis is like a **house with no lock on the front door** by default.

Anyone who can reach the port can come in and read everything. The container we set up has
**no password, no user, no encryption** — and that is the **default**.

Security is not something you add later. It is something you set up **before** you put any
real data in.

---

## 2. Real name

Redis security has three layers:

1. **Network** — bind to localhost, firewall the port, use TLS.
2. **Authentication** — `requirepass`, or ACLs (Redis 6+).
3. **Authorisation** — ACLs restrict which commands and keys each user can touch.

### Commands

| Command | What it does |
|---|---|
| `ACL SETUSER` | Create or modify a user |
| `ACL DELUSER` | Remove a user |
| `ACL LIST` | List all users |
| `ACL USERS` | List usernames |
| `ACL GETUSER` | Show one user's rules |
| `ACL WHOAMI` | Who am I? |
| `ACL CAT` | List command categories |
| `ACL GENPASS` | Generate a password |
| `ACL LOG` | Recent auth failures |
| `ACL SAVE` / `ACL LOAD` | Persist / reload ACLs |
| `AUTH user password` | Authenticate |
| `CONFIG SET requirepass` | Set a global password (legacy) |
| `CLIENT KILL` | Drop a connection |

---

## 3. redis-cli example

### The default state — verified

```bash
docker exec redis-learn redis-cli ACL WHOAMI
```
```redis
"default"
```

```bash
docker exec redis-learn redis-cli ACL LIST
```
```redis
user default on nopass ~* &* +@all
```

Translation: the `default` user is **on**, has **no password**, can touch **all keys**
(`~*`) and **all channels** (`&*`), and can run **all commands** (`+@all`).

Verified: there is **no password** and **no TLS** on this server.

### Create a read-only user

```redis
127.0.0.1:6379> ACL SETUSER reader on >secret123 ~* +@read
OK
127.0.0.1:6379> AUTH reader secret123
OK
127.0.0.1:6379> GET mykey
"value"
127.0.0.1:6379> SET mykey "nope"
(error) NOPERM this user has no permissions to run the 'set' command
```

### Create a user scoped to one key prefix

```redis
127.0.0.1:6379> ACL SETUSER app on >apppass ~app:* +@read +@write -@dangerous
OK
```

`~app:*` means this user can only touch keys starting with `app:`. `+@read +@write`
grants read and write commands. `-@dangerous` removes dangerous ones.

### Generate a password

```redis
127.0.0.1:6379> ACL GENPASS
"3f7a2b9c..."
```

### TLS

Redis 8 supports TLS natively. Enable it in `redis.conf`:

```
tls-port 6380
tls-cert-file /path/to/redis.crt
tls-key-file  /path/to/redis.key
tls-ca-cert-file /path/to/ca.crt
```

Then connect with `rediss://`:

```javascript
createClient({ url: 'rediss://user:pass@host:6380' });
```

---

## 4. Node.js example

### Verified output of `examples/26-security.mjs`

```
--- who am I? (default user) ---
ACL WHOAMI -> default
ACL LIST   -> [ 'user default on nopass ~* &* +@all' ]
  ^ no password, all keys, all commands. This is the default. Change it.

--- creating a read-only user ---
ACL SETUSER reader on >secret123 ~* +@read -> OK
ACL GETUSER reader -> { flags: [ 'on' ], passwords: [ '...' ], commands: '+@read', keys: [ '*' ], ... }
AUTH reader secret123 -> OK
GET with reader -> value
SET with reader -> NOPERM this user has no permissions to run the 'set' command
  ^ read-only user cannot write. Verified.

--- scoped user (prefix + command categories) ---
ACL SETUSER scoped on >scopedpass ~app:* +@read +@write -@dangerous -> OK
scoped can read app:foo  -> foo
scoped cannot read other:x -> NOPERM No permissions to access a key
scoped can write app:bar -> OK
scoped cannot FLUSHDB    -> NOPERM this user has no permissions to run the 'flushdb' command

--- ACL LOG (auth failures) ---
ACL LOG length -> 2
last entry -> { client: '127.0.0.1:...', reason: 'auth', ... }

--- connection kill ---
CLIENT KILL ID <id> -> 1  (drops a connection immediately)

--- dangerous commands to disable in production ---
FLUSHALL, FLUSHDB, KEYS, CONFIG, DEBUG, SHUTDOWN, SLAVEOF/REPLICAOF
  ^ disable with -@dangerous or +@all -<command>

DBSIZE after cleanup: 0
```

### The API

```javascript
import { createClient } from 'redis';

// With a password
const client = createClient({ url: 'redis://reader:secret123@127.0.0.1:6379' });
await client.connect();

// Or pass discrete options
const c2 = createClient({ username: 'reader', password: 'secret123', socket: { host, port } });

// Run an ACL command as the admin
await client.sendCommand(['ACL', 'SETUSER', 'reader', 'on', '>secret123', '~*', '+@read']);
await client.sendCommand(['ACL', 'DELUSER', 'reader']);
```

### 🔴 The default user is dangerous

Verified:

```
user default on nopass ~* &* +@all
```

**No password. All keys. All commands.** If your Redis is reachable from the network, anyone
can `FLUSHALL` it. Change this before deploying.

### ACL syntax cheat sheet

```
ACL SETUSER <name>
  on | off                              # enabled?
  >password                             # set password
  <password                             # remove password
  nopass                                 # no password required
  ~pattern                              # key patterns this user can touch
  &pattern                              # channel patterns for pub/sub
  +@category | -@category               # command categories
  +command | -command                   # individual commands
  reset                                  # clear everything
  resetpass                              # clear passwords
  resetkeys                              # clear key patterns
```

Categories: `@read`, `@write`, `@set`, `@list`, `@hash`, `@string`, `@stream`, `@admin`,
`@dangerous`, `@connection`, `@pubsub`, `@scripting`, `@slow`, `@fast`, `@all`.

### ACL persistence

```redis
ACL SAVE       # writes to the ACL file (aclfile in redis.conf)
ACL LOAD       # reloads from the file
```

⚠️ **Without an `aclfile` configured**, ACLs live in memory and are lost on restart. Set
`aclfile /etc/redis/users.acl` in `redis.conf`.

---

## 5. When to use it and when NOT to

### ✅ Do these

- Set a **password** on the `default` user (or disable it).
- Create **per-application users** with least privilege.
- Use **TLS** in production.
- **Bind** to localhost or a private network.
- Use **firewalls** to restrict port 6379.
- **Disable dangerous commands** (`FLUSHALL`, `CONFIG`, `DEBUG`, `KEYS`).
- **Rotate passwords** periodically.
- **Audit** with `ACL LOG`.

### ❌ Don't do these

| Situation | Why | Fix |
|---|---|---|
| Redis exposed to the internet | Anyone can read/write everything | Bind to localhost, firewall |
| No password in production | Default user has `nopass` | Set a password or disable default |
| One shared password for all apps | No audit trail, blast radius | Per-app ACL users |
| `requirepass` only (no ACLs) | All users share one password | Migrate to ACLs (Redis 6+) |
| TLS off between services | Passwords and data in plaintext | Enable TLS |
| `CONFIG` allowed to app users | They can change settings or read secrets | `-@admin` or `-CONFIG` |
| `KEYS` allowed to app users | Blocks the server | Disable it |
| ACLs not persisted | Lost on restart | Set `aclfile` |

### 🔴 The "Redis is on a private network" myth

Verified: this container's `protected-mode` is `no` (because it has no password and binds
to `*`). Even on a private network, a compromised internal service can read your entire
Redis. Always set a password.

---

## 6. Common mistakes

**Mistake 1 — Leaving the `default` user with `nopass`.**
Verified: `user default on nopass ~* &* +@all`. Anyone with network access owns your data.

**Mistake 2 — `requirepass` only, no ACLs.**
All clients share one password. Use ACLs for per-app isolation.

**Mistake 3 — Forgetting `aclfile`.**
ACLs are in-memory by default. A restart wipes them. Verified: this container has no
config file at all.

**Mistake 4 — Allowing `FLUSHALL` to application users.**
One bug in one app can wipe every database.

**Mistake 5 — Allowing `KEYS` to application users.**
One accidental `KEYS *` blocks the server for everyone.

**Mistake 6 — Not using TLS between services.**
Passwords and data travel in plaintext. Use `rediss://`.

**Mistake 7 — Storing passwords in code.**
Use environment variables or a secret manager.

**Mistake 8 — Not monitoring `ACL LOG`.**
Auth failures are the first sign of an attack or a misconfigured client.

**Mistake 9 — `maxmemory` without eviction on a multi-tenant server.**
One tenant can OOM the server for everyone.

**Mistake 10 — Assuming `protected-mode` protects you.**
It only blocks external connections when there is no password **and** the server binds to
all interfaces. Verified: this container has `protected-mode: no`.

---

## 7. Try it yourself

**Exercise:** Create a user `cacheapp` that can only `GET`/`SET` keys matching `cache:*`,
cannot run `FLUSHDB`, and has a generated password. Then connect with that user and try to
`SET other:x 1` and `FLUSHDB` — both should fail.

**Hint:** `ACL SETUSER cacheapp on >$(ACL GENPASS) ~cache:* +@read +@write -FLUSHDB`.
Then connect with `redis://cacheapp:<password>@host:6379`.

**What to notice:** `NOPERM` errors are **explicit**, not silent. Your application will fail
loudly if it tries to do something it shouldn't — which is exactly what you want.

**Stretch:** enable TLS on a local Redis and connect with `rediss://`.

---

## 8. Next

**[Chapter 27 — Monitoring and debugging](27-monitoring-and-debugging.md)** — `INFO`,
`SLOWLOG`, `LATENCY`, and how to find out what is slow.

---

**Verified facts recap**

| Claim | How verified |
|---|---|
| Default user: `user default on nopass ~* &* +@all` | `ACL LIST` |
| `ACL WHOAMI` → `default` | Direct |
| `protected-mode` = `no` on this container | `CONFIG GET` |
| Read-only user: `GET` works, `SET` → `NOPERM` | Direct |
| Scoped user: `app:*` readable, `other:x` → `NOPERM` | Direct |
| `FLUSHDB` refused for scoped user | Direct |
| `ACL LOG` recorded the failures | Direct |
| `CLIENT KILL ID` drops a connection | Direct |
| `ACL GENPASS` generates a password | Direct |
| ACLs are in-memory (no `aclfile`) | `CONFIG GET aclfile` empty |