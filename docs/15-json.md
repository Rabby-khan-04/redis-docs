# Chapter 15 — RedisJSON

> **Verified on:** Redis **8.10.2**, node-redis **6.3.0**, RedisJSON **81000**
> Run the code: `node examples/15-json.mjs`

---

## 1. Simple explanation (like I'm 7)

A **string** holding JSON is like a whole page in a notebook. To change one word, you have
to **rewrite the entire page**.

RedisJSON is like a **spreadsheet cell**. You can change the price in cell `C7` without
touching anything else — even if it is deep inside nested folders.

It also lets you ask questions with a path: *"give me only the pets array"* or *"give me
only the dogs older than 2"*.

---

## 2. Real name

**RedisJSON** is a **module** that adds a native `ReJSON-RL` data type: JSON values stored,
queried and **partially updated** with **JSONPath**.

Verified: `TYPE` on a JSON key returns **`ReJSON-RL`**.

### Setup — two things you must get right

```bash
npm install @redis/json
```

```javascript
// ⚠️ 1. The module must be passed in the `modules` option
// ⚠️ 2. In an ESM project the import is DOUBLE-wrapped
const json = (await import('@redis/json')).default.default;

const client = createClient({ url: 'redis://127.0.0.1:6379', modules: { json } });
```

The plain `createClient()` has **no** `c.json`. Verified.

The double `.default` is CJS/ESM interop: `import json from '@redis/json'` gives you
`{ default: {...commands} }`, not the command object. Using the single-wrapped version gives
`typeof c.json.set === 'undefined'`.

### Commands

| Command | What it does |
|---|---|
| `JSON.SET key path value` | Set at a path (creates if `NX` not given) |
| `JSON.GET key [path...]` | Read all, or at paths |
| `JSON.MGET key... path` | Read several keys at one path |
| `JSON.MSET key value...` | Write several keys |
| `JSON.DEL key [path]` | Delete key or a path |
| `JSON.TYPE key [path]` | `object`, `array`, `string`, `integer`, … |
| `JSON.OBJKEYS` / `OBJLEN` | Object keys / length |
| `JSON.ARRLEN` / `ARRAPPEND` / `ARRINSERT` / `ARRINDEX` / `ARRPOP` | Array operations |
| `JSON.NUMINCRBY key path n` | Increment a number **in place** |
| `JSON.MERGE key path value` | Recursive merge (RFC 7396) |
| `JSON.STRAPPEND key path value` | Append to a string |
| `JSON.DEBUG key [subcmd]` | Memory introspection |

### JSONPath basics

| Path | Means |
|---|---|
| `$` | Root (required) |
| `$.name` | The `name` field |
| `$.pets[0]` | First element |
| `$.pets[*]` | Every element |
| `$.pets[*].name` | Every element's `name` |
| `$.pets[?(@.age>2)]` | Filter (recursive descent, `$..`) |
| `$.*` | Every top-level field |

---

## 3. redis-cli example

```bash
docker exec -it redis-learn redis-cli
```

```redis
127.0.0.1:6379> JSON.SET doc '$' '{"name":"Roberta","pets":[{"name":"Rex","species":"dog","age":3},{"name":"Goldie","species":"fish","age":2}]}'
OK

127.0.0.1:6379> TYPE doc
ReJSON-RL

127.0.0.1:6379> JSON.GET doc '$.name'
["Roberta"]
127.0.0.1:6379> JSON.GET doc '$.pets[*].name'
["Rex","Goldie"]
127.0.0.1:6379> JSON.GET doc '$.pets[?(@.age>2)]'
[{"name":"Rex","species":"dog","age":3}]
```

### Partial update — the whole point

```redis
127.0.0.1:6379> JSON.SET doc '$.name' '"Roberta Smith"'
OK
127.0.0.1:6379> JSON.GET doc '$.name'
["Roberta Smith"]
```

The rest of the document was never read and never rewritten.

### Arrays

```redis
127.0.0.1:6379> JSON.SET arr '$' '["a"]'
OK
127.0.0.1:6379> JSON.ARRAPPEND arr '$' '"b"'
(integer) 2
127.0.0.1:6379> JSON.GET arr
["a","b"]
127.0.0.1:6379> JSON.ARRPOP arr '$'
"b"
```

### Merge with RFC 7396 semantics

```redis
127.0.0.1:6379> JSON.SET m '$' '{"a":1,"b":2}'
OK
127.0.0.1:6379> JSON.MERGE m '$' '{"b":99,"c":3,"d":null}'
OK
127.0.0.1:6379> JSON.GET m
{"a":1,"b":99,"c":3}
```

Note: **`d` is gone**, because `null` means *delete* in RFC 7396.

---

## 4. Node.js example

### Verified output of `examples/15-json.mjs`

```
--- basics ---
JSON.SET -> OK
TYPE     -> ReJSON-RL   (a JSON value is type "ReJSON-RL")
JSON.GET -> {
  name: 'Roberta McDonald',
  pets: [
    { name: 'Rex', species: 'dog', age: 3, isMammal: true },
    { name: 'Goldie', species: 'fish', age: 2, isMammal: false }
  ]
}

--- JSONPath reads ---
$.name                -> [ 'Roberta McDonald' ]
$.pets[*].name         -> [ 'Rex', 'Goldie' ]
$.pets[0]              -> [ { name: 'Rex', species: 'dog', age: 3, isMammal: true } ]
$.pets[?(@.age>2)]     -> [ { name: 'Rex', species: 'dog', age: 3, isMammal: true } ]
$.pets[1].species      -> [ 'fish' ]
two paths at once      -> { '$.pets[0].species': [ 'dog' ], '$.name': [ 'Roberta McDonald' ] }

--- partial updates (the big win over strings) ---
before name    -> [ 'Roberta McDonald' ]
after SET name -> [ 'Roberta Smith' ]
  ^ the rest of the document was never read or rewritten

array append:
  before        -> [ 'a' ]
  arrAppend b   -> [ 2 ]
  after         -> [ 'a', 'b' ]
  arrInsert 0 z -> [ 3 ]
  after         -> [ 'z', 'a', 'b' ]
  arrIndex $.[1]-> [ 2 ] (0-based)
  arrPop        -> b
  after         -> [ 'z', 'a' ]

object helpers:
  objKeys $     -> [ 'name', 'pets' ]
  objLen  $     -> 2
  type     $    -> object

--- ⚠️ paths must exist ---
arrAppend onto a path that does not exist:
  before -> { name: 'x' }
  after  -> { name: 'x' }   <- unchanged, silently
  FIX: create the array first
  after  -> { name: 'x', tags: [ 'x' ] }

--- multi ---
json.mGet([m1,m2], "$") -> [ [ { a: 1, b: 2 } ], [ { b: 3, c: 4 } ] ]

--- merge (RFC 7396: null deletes a key) ---
merge -> { a: 1, b: 99, c: 3 }
  ^ "d": null DELETED the key (RFC 7396 semantics)

--- numIncrBy ---
numIncrBy $.views 5 -> [ 15 ]
document -> { views: 15, likes: 3 }

--- comparison: change one nested field three ways ---
string  -> {"user":{"id":42,"name":"Ada","prefs":{"theme":"light","lang":"en"}}}
json    -> [ { theme: 'light', lang: 'en' } ]
  ^ ONE command, ONE path. No parse, no full rewrite.

DBSIZE after cleanup: 0
```

### 🔴 The path is an OPTION, not a positional argument

This is the biggest trap in the module, and it fails **silently**:

```javascript
// ✗ WRONG - the path string is treated as the options object,
//           which has no .path, so Redis gets NO path and returns the WHOLE doc
await client.json.get(key, '$.name');

// ✓ CORRECT
await client.json.get(key, { path: '$.name' });
```

Verified side by side:

```
positional (WRONG) -> {"name":"Ada","pets":[...]}      ← whole document
option   (RIGHT) -> ["Ada"]
```

My first run of this chapter printed the entire document for `$.name`,
`$.pets[*].name`, `$.pets[0]`, and the filter — all silently wrong. The signature is
`get(key, options?: { path, reviver })`.

### The right shapes

```javascript
await client.json.get(key, { path: '$.name' });                  // one path
await client.json.get(key, { path: ['$.name', '$.pets[0]'] });   // several
await client.json.mGet([k1, k2], '$');                          // path is REQUIRED
```

Verified:

```
two paths at once -> { '$.pets[0].species': [ 'dog' ], '$.name': [ 'Roberta McDonald' ] }
json.mGet([m1,m2], "$") -> [ [ { a: 1, b: 2 } ], [ { b: 3, c: 4 } ] ]
```

Note: multiple paths come back as an **object keyed by path**, which is convenient.
A single path returns an **array** of matches.

### ⚠️ Array operations need the array to exist

```javascript
await client.json.set('doc', '$', { name: 'x' });
await client.json.arrAppend('doc', '$.tags', 'x');   // $.tags does not exist
// document is UNCHANGED, silently
```

Verified:

```
arrAppend onto a path that does not exist:
  before -> { name: 'x' }
  after  -> { name: 'x' }   <- unchanged, silently
  FIX: create the array first
  after  -> { name: 'x', tags: [ 'x' ] }
```

Fix: `JSON.SET key '$.tags' '[]'` first, or use `JSON.MERGE`.

### Partial update vs string — the comparison

Starting document:

```javascript
{ user: { id: 42, name: 'Ada', prefs: { theme: 'dark', lang: 'en' } } }
```

**String approach** — 4 steps, race-prone:

```javascript
const s = JSON.parse(await client.get('as:string'));
s.user.prefs.theme = 'light';           // 1. read whole doc
await client.set('as:string', JSON.stringify(s));   // 2. rewrite whole doc
// 3. any concurrent write to another field is LOST
// 4. full document crosses the network twice
```

**RedisJSON approach** — 1 command:

```javascript
await client.json.set('as:json', '$.user.prefs.theme', 'light');
```

Verified results:

```
string  -> {"user":{"id":42,"name":"Ada","prefs":{"theme":"light","lang":"en"}}}
json    -> [ { theme: 'light', lang: 'en' } ]
```

---

## 5. When to use it and when NOT to

### ✅ Use RedisJSON when

- Documents are **nested** (arrays of objects, objects in objects).
- You need **partial updates** without rewriting everything.
- You read **sub-parts** of large documents often.
- You want **in-place numeric increments** (`JSON.NUMINCRBY`).
- Documents are **moderate in size** (a few KB).
- You will index them with [RediSearch](16-search.md).

### ❌ Don't use it when

| Situation | Why | Use instead |
|---|---|---|
| Data is **flat** with few fields | Hash is lighter | [Hash](07-hashes.md) |
| You only need **whole-blob** get/put | String is simpler | [String](05-strings.md) |
| Documents are **very large** (MBs) | JSON overhead and rewrites | Object storage |
| You need **cross-document transactions** | JSON is still single-key | SQL |
| You need **field-level TTLs** | JSON has no per-field TTL | [Hash](07-hashes.md) |
| You need **versioning / history** | No built-in | Store versions separately |

### JSON vs Hash

| | Hash | RedisJSON |
|---|---|---|
| Nested data | ❌ flat only | ✅ |
| Partial update of one field | ✅ | ✅ |
| Partial update of a **nested** path | ❌ | ✅ |
| Read a sub-path | ❌ | ✅ |
| Field-level TTL | ✅ | ❌ |
| Memory overhead | Lower | Higher |
| Best for | flat records | nested documents |

---

## 6. Common mistakes

**Mistake 1 — Passing the path positionally to `json.get`.**
`get(key, '$.x')` **silently returns the whole document**. Use `get(key, { path: '$.x' })`.
Verified: this affected 4 lines in my first run without any error.

**Mistake 2 — Forgetting the `modules: { json }` option.**
`client.json` is `undefined`. Verified.

**Mistake 3 — Not unwrapping the ESM import.**
`import json from '@redis/json'` gives `{ default: {...} }`. Use
`(await import('@redis/json')).default.default`. Verified: the single-wrapped version leaves
`c.json.set` undefined.

**Mistake 4 — `JSON.ARRAPPEND` on a missing path.**
Silently does nothing. Create the array first. Verified.

**Mistake 5 — `json.mGet(keys)` without a path.**
The path argument is **required**: `mGet(keys, path)`. Verified: throws.

**Mistake 6 — Not knowing that a single path returns an array.**
`$.name` → `['Roberta']`, not `'Roberta'`. Multiple paths return an **object** keyed by path.

**Mistake 7 — `JSON.MERGE` with `null` expecting it to store null.**
RFC 7396: `null` **deletes** the key. Verified: `d` disappeared.

**Mistake 8 — Using `$..` recursive descent on large documents.**
It walks everything and is slow. Use explicit paths.

**Mistake 9 — Huge documents.**
RedisJSON has overhead per element. Split very large documents into related keys.

**Mistake 10 — Forgetting `JSON.GET` returns parsed JS.**
node-redis parses it for you. redis-cli returns a **JSON string** you must parse.

---

## 7. Try it yourself

**Exercise:** Store a product catalogue document. Then, without ever reading the whole
document: (a) increment `$.stock` for product 1, (b) append a tag to its `$.tags` array,
(c) read only the price, and (d) list every product name. Finally delete one product from
the `$.products` array with `arrPop`.

**Hint:** `json.numIncrBy(key, '$.stock', 1)`, then create the array with
`json.set(key, '$.tags', [])` **before** `arrAppend`. For (d),
`json.arrPop(key, '$.products', 1)` returns the popped element.

**What to notice:** four separate operations, each touching one path, and the document never
travels over the network in full. Compare with the string approach, which needs a full read
and full write per change.

---

## 8. Next

**[Chapter 16 — Search and querying](16-search.md)** — making those documents (and hashes)
actually findable with full-text and faceted search.

---

**Verified facts recap**

| Claim | How verified |
|---|---|
| `TYPE` of a JSON key is `ReJSON-RL` | Direct |
| Module needed via `modules: { json }` | `c.json` undefined without it |
| ESM import needs **double** `.default` | Single-wrapped → `c.json.set` undefined |
| `json.get(key, '$.x')` **silently returns everything** | Side-by-side comparison |
| `json.get(key, { path: '$.x' })` is correct | `['Ada']` |
| Multiple paths → object keyed by path | `{'$.name': [...]}` |
| `$.pets[?(@.age>2)]` filters | `[ {name:'Rex', ...} ]` |
| `arrAppend` on a missing path is a silent no-op | Before/after identical |
| `json.mGet` needs a path argument | Throws without it |
| `JSON.MERGE` with `null` **deletes** | `d` disappeared |
| `numIncrBy` increments in place | 10 → 15 |
| Partial update = 1 command, no full rewrite | Verified |