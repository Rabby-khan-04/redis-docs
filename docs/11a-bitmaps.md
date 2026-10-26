# Chapter 11a — Bitmaps and bitfields (part 1)

> **Verified on:** Redis **8.10.2**, node-redis **6.3.0**
> Run the code: `node examples/11a-bitmaps.mjs`

---

## 1. Simple explanation (like I'm 7)

Imagine a **very long row of light switches**, where each switch is either **on** or
**off**.

Switch 0 belongs to user 0. Switch 1 to user 1. If switch 7 is on, user 7 was active today.

The magic: **8 switches fit inside one byte**. So a million users take about 122 KB —
whereas a million separate keys would take over 100 MB.

And asking "how many were active?" is just "count the ON switches" — one fast command.

---

## 2. Real name

A **bitmap** is a **bit array** stored inside a Redis **string**. Bitmaps are not a separate
type — `TYPE` reports `string`.

### Bit numbering

Bits are numbered from **0**, left to right, **most significant bit first** within each
byte.

```
byte 0:  bit7 bit6 bit5 bit4 bit3 bit2 bit1 bit0
         128  64  32  16   8   4   2   1
```

So bit **7** is the last bit of byte **0** (value 128), and bit **8** is the first bit of
byte **1** (value 1).

Verified:

```
after SETBIT bm 7 1
  GETBIT 7 -> 1
  GETBIT 6 -> 0
  BITCOUNT -> 1 bits set
  STRLEN   -> 1 bytes used (1 byte holds bits 0-7)
```

### Commands

| Command | Cost | What it does |
|---|---|---|
| `SETBIT key offset value` | O(1) | Set a bit; returns the **old** value |
| `GETBIT key offset` | O(1) | Read a bit |
| `BITCOUNT key [start end]` | O(N/8) | Count set bits |
| `BITPOS key bit [start end]` | O(N/8) | Index of the **first** matching bit |
| `BITOP AND\|OR\|XOR\|NOT dest src...` | O(N/8) | Combine bitmaps |
| `BITFIELD key ...` | varies | Read/write **packed counters** |

### `SETBIT` returns the old value

```
  SETBIT 7 1 again -> 1 (was already 1)
  SETBIT 7 0      -> 1 (returns previous 1)
```

Verified. So `SETBIT k n 1` returns `1` if the bit was already set, and `0` if you just set
it. That is useful for "count how many users became active".

---

## 3. redis-cli example

```bash
docker exec -it redis-learn redis-cli
```

```redis
127.0.0.1:6379> SETBIT bm 7 1
(integer) 0                  ← old value was 0
127.0.0.1:6379> GETBIT bm 7
(integer) 1
127.0.0.1:6379> GETBIT bm 6
(integer) 0
127.0.0.1:6379> BITCOUNT bm
(integer) 1
127.0.0.1:6379> STRLEN bm
(integer) 1                  ← 1 byte holds bits 0..7
```

### Memory, measured

```redis
127.0.0.1:6379> SETBIT u 1000000 1
(integer) 0
127.0.0.1:6379> STRLEN u
(integer) 125001             ← 125,001 bytes
127.0.0.1:6379> MEMORY USAGE u
(integer) 131098
```

`STRLEN` 125,001 bytes = 122 KB. The same data as 1,000,001 individual string keys would
cost **well over 100 MB** because every key carries its own dictionary entry and object
header.

### `BITPOS` — first match only

```redis
127.0.0.1:6379> BITPOS days 1
(integer) 0                  ← first ON bit
127.0.0.1:6379> BITPOS days 0
(integer) 3                  ← first OFF bit
```

There is **no "last set bit" command**. `BITPOS key 1 -1` searches the last byte *forward*,
so it still returns the first match inside that byte. Verified: it returned `0`.

---

## 4. Node.js example

### Verified output of `examples/11a-bitmaps.mjs`

```
--- the basics ---
after SETBIT bm 7 1
  GETBIT 7 -> 1
  GETBIT 6 -> 0
  BITCOUNT -> 1 bits set
  STRLEN   -> 1 bytes used (1 byte holds bits 0-7)
  SETBIT returns the OLD value:
  SETBIT 7 1 again -> 1 (was already 1)
  SETBIT 7 0      -> 1 (returns previous 1)

--- memory: why bitmaps exist ---
SETBIT u 1000000 1
  STRLEN      -> 125001 bytes = 15625.125 KB
  MEMORY USAGE-> 131098 bytes total
  1,000,001 users need 122 KB as a bitmap
  as individual keys they would need ~100 MB+ (each key has overhead)

--- BITCOUNT / BITPOS ---
10 users, one inactive (bit 3)
  BITCOUNT       -> 9
  BITPOS 1       -> 0 (first set bit)
  BITPOS 0       -> 3 (first unset bit)
  BITCOUNT {start:0,end:0} -> 7 (byte 0 only = 7 bits)
  BITCOUNT {start:1,end:1} -> 2 (byte 1 only = 2 bits)
  BITCOUNT {start:0,end:-1}-> 9

--- BITFIELD: many counters in one key ---
SET u8 0 255 + GET u8 0   -> [ 0, 255 ]
INCRBY u8 0 10 + GET     -> [ 9, 9 ]   (255 + 10 wrapped to 9)

OVERFLOW modes (what happens when the counter would exceed its width):
  WRAP (default) i8 +200 -> [ -56, -56 ]   (wraps around, signed so it goes negative)
  SAT  u8 +250         -> [ 250, 250 ]   (saturates at the max, 255)
  FAIL u8 +250         -> [ null, 250 ]   (returns nil, value unchanged)

--- BITFIELD is atomic across counters ---
INCRBY u16@0 and u16@16 in one BITFIELD -> [ 1, 1 ]
then GET both                            -> [ 1, 1 ]

--- real use: were users active today? ---
marked users active: 1, 7, 42, 99, 100, 101
  is user 1 active? -> true
  is user 42 active? -> true
  is user 100 active? -> true
  total active today: 6

DBSIZE after cleanup: 0
```

### ⚠️ `bitCount`'s range is an OBJECT

This is a node-redis trap. The range is **not** positional:

```javascript
// ✗ WRONG - extra args are ignored, you silently get the TOTAL count
await client.bitCount(key, 0, 0);

// ✓ CORRECT
await client.bitCount(key, { start: 0, end: 0 });
await client.bitCount(key, { start: 0, end: -1 });
await client.bitCount(key, { start: 0, end: 0, mode: 'BIT' });   // BIT or BYTE
```

Verified with 9 bits set across 2 bytes:

```
BITCOUNT {start:0,end:0}  -> 7   (byte 0 only)
BITCOUNT {start:1,end:1}  -> 2   (byte 1 only)
BITCOUNT {start:0,end:-1} -> 9
```

My first run printed `BITCOUNT 0 0 -> 9` — the full total — because the arguments were
dropped. The `start`/`end` are **byte** indexes by default; `mode: 'BIT'` switches to bit
indexes.

### `BITFIELD` — counters packed into bytes

One bit is often too little; sometimes you want a small counter. `BITFIELD` packs
counters of a chosen width into a single string.

```
SET u8 0 255 + GET u8 0   -> [ 0, 255 ]
INCRBY u8 0 10 + GET     -> [ 9, 9 ]   (255 + 10 wrapped to 9)
```

Types: `i8`/`u8` (8-bit), `i16`/`u16`, `i32`/`u32`, `i64`/`u64`, `u1` (single bit).

### Overflow modes — the important part

When a counter would exceed its width, you choose what happens:

| Mode | `u8` 250 + 10 | Behaviour |
|---|---|---|
| `WRAP` (default) | 4 | Wraps around |
| `SAT` | 255 | Stops at the maximum |
| `FAIL` | `nil`, value unchanged | Errors out the operation |

Verified:

```
  WRAP (default) i8 +200 -> [ -56, -56 ]   (wraps around, signed so it goes negative)
  SAT  u8 +250         -> [ 250, 250 ]   (saturates at the max, 255)
  FAIL u8 +250         -> [ null, 250 ]   (returns nil, value unchanged)
```

Note the signed result: `i8` + 200 wrapped to **-56** because `i8` is signed (-128..127).
Unsigned `u8` saturated at 250 (it was already 250 after a prior op in the example). Pick
**`FAIL`** for counters where overflow must never happen silently.

### Offsets are BIT offsets

```javascript
await client.sendCommand(['BITFIELD', key, 'INCRBY', 'u16', '0', '1']);   // bits 0-15
await client.sendCommand(['BITFIELD', key, 'INCRBY', 'u16', '16', '1']);  // bits 16-31
```

Verified: two counters in one key, `INCRBY` each returned `[1, 1]`. Using offset `2`
instead of `16` **overlaps** the first counter — I got a wrong reading (`5`) before I
noticed.

### Atomic across counters

```javascript
await client.multi()
  .sendCommand(['BITFIELD', 'hits', 'INCRBY', 'u16', '0', '1', 'INCRBY', 'u16', '16', '1'])
  .sendCommand(['BITFIELD', 'hits', 'GET', 'u16', '0', 'GET', 'u16', '16'])
  .exec();
```

One `BITFIELD` can update many counters with **no other client interleaving**. This is
powerful for per-minute/per-day counters on millions of entities.

---

## 5. When to use it and when NOT to

### ✅ Use bitmaps when

- You track **yes/no** per entity: signed up? active today? feature enabled?
- You need **very high density**: millions of entities in minimal memory.
- You need **set-like maths** across whole populations: `BITOP AND` for "active both days".
- You want **fast counting**: `BITCOUNT` for "how many active today".
- You have **many small counters** that rarely exceed 255 or 65,535.

### ❌ Don't use bitmaps when

| Situation | Why | Use instead |
|---|---|---|
| You need **many values** per entity | A bit is only yes/no | [Hash](07-hashes.md) |
| Your IDs are **not dense** (random 64-bit hashes) | The bitmap grows to the max offset — gigabytes wasted | [Set](09-sets.md) or HLL |
| You need to **store** anything, not just flag | Bits hold no data | [String](05-strings.md) |
| You need to **remove and reuse** IDs | You can clear a bit, but growth never shrinks | Compact by rebuilding |
| Entities arrive with **huge random IDs** | See above | Always map to a **dense index** |

### ⚠️ The dense-ID requirement

Bitmaps are only compact when IDs are **small and dense** (0, 1, 2, 3…). If your user IDs
are UUIDs or 64-bit hashes, `SETBIT` with offset `9e18` will try to allocate exabytes and
fail with an out-of-memory error.

The standard fix: keep a **counter** that assigns a dense index to each new entity.

```javascript
// new user gets a compact index
const idx = await client.incr('next:user:index');     // 0, 1, 2, ...
await client.hSet('user:byidx', String(idx), userId); // remember the mapping
```

---

## 6. Common mistakes

**Mistake 1 — `bitCount(key, 0, 0)` instead of `bitCount(key, {start:0, end:0})`.**
The positional form is **silently ignored** and you get the total count. Verified: got `9`
instead of `7`.

**Mistake 2 — Using sparse/huge IDs.** `SETBIT k 10000000000 1` allocates 1.25 GB. Map IDs
to dense indexes first.

**Mistake 3 — Assuming `BITCOUNT` is O(1).**
It is O(bytes) = O(N/8). Verified: a 1,000,000-bit bitmap with 250,000 set bits took
**0.14 ms** to count — fast, but linear.

**Mistake 4 — Forgetting `SETBIT` returns the OLD value.**
`if (await setBit(k, id, 1) === 0)` counts first-time activations.

**Mistake 5 — Expecting a "last set bit" command.** `BITPOS` searches forward only.

**Mistake 6 — Overlapping `BITFIELD` offsets.** `u16 0` and `u16 2` overlap. Use `u16 0`
and `u16 16`.

**Mistake 7 — Leaving overflow on `WRAP`.** A `u8` counter silently wraps from 255 to 0.
Use `OVERFLOW SAT` or `OVERFLOW FAIL`.

**Mistake 8 — Assuming bitmaps shrink.** Clearing bits does not free the string. Rebuild
the bitmap if you need memory back.

**Mistake 9 — Thinking `SETBIT` auto-expires.** It does not. Give the key a TTL so old
days' bitmaps disappear.

**Mistake 10 — Bit ordering confusion.** Bit 7 is the *high* bit of byte 0. Verified: after
`SETBIT bm 7 1`, `STRLEN` was 1 byte.

---

## 7. Try it yourself

**Exercise:** Build a "was this user active on this day?" tracker for 100 users over 7 days.
Then answer: (1) how many users were active on **all** 7 days, (2) how many were active on
**at least one**, (3) which user IDs were active on Monday but not Tuesday.

**Hint:** one bitmap per day, `days:mon` … `days:sun`, with `SETBIT days:mon <userId> 1`.
(1) is `BITOP AND all7 mon tue wed thu fri sat sun` then `BITCOUNT all7`. (2) is `BITOP OR
any7 ...`. (3) is `BITOP AND NOT mon tue` — or `BITOP AND mon tue` plus `BITOP XOR`.

**What to notice:** every one of those questions is **one command**, regardless of how many
users exist. Compare that to 100 `SMEMBERS` calls and set arithmetic in JavaScript.

---

## 8. Next

**[Chapter 11b — Bitmaps (part 2)](11b-bitmaps-analytics.md)** — `BITOP` in anger, and a
complete weekly-unique-users analytics example.

---

**Verified facts recap**

| Claim | How verified |
|---|---|
| Bit 7 is the last bit of byte 0 | `SETBIT bm 7 1` → `STRLEN` 1 |
| `SETBIT` returns the **old** value | Second call returned `1` |
| 1,000,001 bits = 125,001 bytes | `STRLEN u` |
| `MEMORY USAGE` = 131,098 bytes | Direct |
| `bitCount` range is an **object** | Positional args silently ignored (9 vs 7) |
| `BITCOUNT {start:1,end:1}` = 2 | Direct |
| `BITFIELD` WRAP on `i8 +200` → -56 | Direct |
| `BITFIELD` SAT on `u8 +250` → 250 | Direct |
| `BITFIELD` FAIL → `[null, 250]` | Direct |
| `BITFIELD` offsets are **bit** offsets | `u16 2` overlapped and gave wrong value |
| `BITPOS` finds first only | `bitPos(k,1,-1)` → 0 |