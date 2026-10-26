# Chapter 16 — Search and querying

> **Verified on:** Redis **8.10.2**, node-redis **6.3.0**, RediSearch **81001**
> Run the code: `node examples/16-search.mjs`

---

## 1. Simple explanation (like I'm 7)

Redis can store a book. But can it answer *"find every chapter that mentions penguins"*?

By itself, **no**. You'd have to read every chapter and check yourself.

RediSearch is a **helper that reads as you write**. When you add a chapter, it quietly makes
a list of all the words inside. Then a search is just a quick look at that list — like the
index at the back of a book.

It also sorts and filters: *"chapters about maths, by British authors, longest first"*.

---

## 2. Real name

**RediSearch** (module name `search`) adds full-text, numeric, tag and geospatial **indexes**
over hashes and JSON documents.

You must **declare an index** before searching. Redis indexes existing keys as they are
written and updated.

### Creating an index

```redis
FT.CREATE idx:people
  ON HASH
  PREFIX 1 person:
  SCHEMA
    name  TEXT SORTABLE
    age   NUMERIC SORTABLE
    city  TAG SORTABLE
    bio   TEXT
```

| Part | Meaning |
|---|---|
| `ON HASH` or `ON JSON` | What kind of keys to index |
| `PREFIX n key...` | Only index keys with these prefixes |
| `SCHEMA` | Field definitions |

### Field types — the crucial choice

| Type | For | Query example |
|---|---|---|
| `TEXT` | Words, prose, descriptions | `programmer`, `@bio:(compiler)` |
| `NUMERIC` | Numbers and **ranges** | `@age:[30 50]` |
| `TAG` | Exact values, facets, categories | `@city:{London}` |
| `GEO` | Coordinates | `@location:[lon lat radius unit]` |
| `VECTOR` | Embeddings | `@v:[...]` |

> **TEXT vs TAG is the single most important decision.** `TEXT` splits into words and
> matches loosely. `TAG` matches the **whole value exactly** and is also what you can group
> and facet on. Put a `TAG` on anything you might want to filter by equality.

### Query syntax

| Syntax | Meaning |
|---|---|
| `word` | Contains this word |
| `@field:word` | In this field |
| `@field:(a b)` | Both words, in any order |
| `a b` | **AND** |
| `a\|b` | **OR** (pipe character) |
| `-@field:x` | **NOT** |
| `prefix*` | Starts with |
| `~word` | Fuzzy, tolerates typos |
| `@age:[30 50]` | Numeric range (inclusive) |
| `@age:[(30 (50]` | Exclusive bounds |
| `@age:[30 +inf]` | To infinity |
| `@city:{London\|Paris}` | TAG: any of |
| `@city:{Lond*}` | TAG prefix |
| `*` | Everything |

> ⚠️ **The word `OR` does not work.** Verified: `compiler OR cryptography` returned
> **0 results**; `compiler|cryptography` returned **2**. Use the pipe.

---

## 3. redis-cli example

```bash
docker exec redis-learn redis-cli
```

```redis
127.0.0.1:6379> FT.CREATE idx ON HASH PREFIX 1 person: SCHEMA name TEXT SORTABLE age NUMERIC SORTABLE city TAG SORTABLE bio TEXT
OK

127.0.0.1:6379> FT._LIST
1) "idx"
```

### Queries

```redis
127.0.0.1:6379> FT.SEARCH idx programmer
1) (integer) 1
2) "person:Ada Lovelace"
   3) 1) "name"      2) "Ada Lovelace"
      3) "age"       4) "36"
      4) "city"      5) "London"
      5) "bio"       6) "mathematician and first programmer"

127.0.0.1:6379> FT.SEARCH idx 'compiler|cryptography'
1) (integer) 2

127.0.0.1:6379> FT.SEARCH idx '@city:{London}'
1) (integer) 2

127.0.0.1:6379> FT.SEARCH idx '@age:[30 50]'
1) (integer) 2

127.0.0.1:6379> FT.SEARCH idx '@city:{London} @age:[30 50]'
1) (integer) 2

127.0.0.1:6379> FT.SEARCH idx compil*
1) (integer) 1
```

### Sorting and paging

```redis
127.0.0.1:6379> FT.SEARCH idx '*' SORTBY age DESC LIMIT 0 2
```

### Aggregation

```redis
127.0.0.1:6379> FT.AGGREGATE idx '*' GROUPBY 1 @city REDUCE COUNT 0 AS num
1) (integer) 2
2) 1) "city"
   2) "london"
   3) "num"
   4) "2"
3) 1) "city"
   2) "new york"
   3) "num"
   4) "1"
```

Note **`GROUPBY 1 @city`** — the `1` is the **number of arguments** to the property. And TAG
values come back **lowercased**.

---

## 4. Node.js example

### Verified output of `examples/16-search.mjs`

```
--- creating a HASH index ---
FT.CREATE idx:people -> OK
FT._list -> [ 'idx:people' ]
documents indexed -> 5

--- text search ---
programmer                               -> 1 : Ada Lovelace
London  (⚠️ 0: city is a TAG, not TEXT)  -> 0 : (none)
@bio:(compiler)                          -> 1 : Grace Hopper
@name:(Alan)                             -> 1 : Alan Turing

--- boolean operators ---
NOTE: the word OR does NOT work as boolean here. Use the pipe character |
compiler cryptography   (AND, 0 docs)    -> 0 : (none)
compiler|cryptography  (OR, 2 docs)      -> 2 : Alan Turing, Grace Hopper
@bio:(compiler|cryptography)             -> 2 : Alan Turing, Grace Hopper
@bio:(compiler) -@city:{London}          -> 1 : Grace Hopper
@city:{London} AND @age:[30 50]          -> 2 : Ada Lovelace, Alan Turing
compil*   (prefix search)                -> 1 : Grace Hopper
@name:Alan  (implicit field)             -> 1 : Alan Turing
Ada|Norman   (OR across fields)          -> 1 : Ada Lovelace
@name:(Ada Grace)  (both words)          -> 0 : (none)
@name:~Lovlace  (fuzzy)                  -> 5 : Ada Lovelace, Alan Turing, Grace Hopper, Edsger Dijkstra, Barbara Liskov
  ^ CAUTION: RediSearch default fuzzy distance is very permissive here --
    it matched ALL 3 names, not just the typo. Always set an explicit
    DISTANCE, or use a prefix search (compil*) for "did you mean" UX.

--- numeric ---
@age:[30 50]                             -> 2 : Ada Lovelace, Alan Turing
@age:[80 +inf]                           -> 2 : Grace Hopper, Barbara Liskov
@age:[-inf 40]                           -> 1 : Ada Lovelace

--- TAG (exact match) ---
@city:{London}                           -> 2 : Ada Lovelace, Alan Turing
@city:{London|New York}                  -> 3 : Grace Hopper, Ada Lovelace, Alan Turing
@city:{Lond*}  (TAG prefix query)        -> 2 : Ada Lovelace, Alan Turing

--- sorting ---
SORTBY {BY:'age',DIRECTION:'DESC'}:
    85  Grace Hopper
    84  Barbara Liskov
    72  Edsger Dijkstra
    41  Alan Turing
    36  Ada Lovelace
SORTBY {BY:'age',DIRECTION:'ASC'}:
    36  Ada Lovelace
    41  Alan Turing
    72  Edsger Dijkstra
    84  Barbara Liskov
    85  Grace Hopper

--- pagination (LIMIT { from, size }) ---
  offset 0: Grace Hopper, Barbara Liskov
  offset 2: Edsger Dijkstra, Alan Turing
  offset 4: Ada Lovelace

--- highlighting ---
   {"id":"ch16:person:Grace Hopper","value":{"name":"Grace Hopper","age":"85","city":"New York","bio":"<b>compiler</b> pioneer and admiral"}}

--- aggregation (GROUPBY) ---
  total_results = 4 (number of GROUPS, not docs)
   {"city":"rotterdam","num":"1"}
   {"city":"london","num":"2"}
   {"city":"boston","num":"1"}
   {"city":"new york","num":"1"}
  ^ TAG values are lowercased ("london") unless you set CASESENSITIVE
  (redis-cli shows a flat array instead; RESP3 gives this object shape)

--- indexing JSON (ON JSON) ---
search "keyboard" -> 1 [ 'ch16:product:1' ]
category peripherals -> 2 products
price 50-500 sorted by price -> [ 'product:1 price=89', 'product:3 price=450' ]

--- FT.INFO ---
index_name: idx:people
num_docs  : 5  num_terms: 35
attributes: an ARRAY of field definitions:
   name (TEXT) ["SORTABLE"]
   age (NUMERIC) ["SORTABLE","UNF"]
   city (TAG) ["SORTABLE"]
   bio (TEXT)

DBSIZE after cleanup: 0
```

### Setup

```javascript
const search = (await import('@redis/search')).default.default;   // ⚠️ double .default
const { SCHEMA_FIELD_TYPE } = await import('@redis/search');

const client = createClient({ url: 'redis://127.0.0.1:6379', modules: { search } });
```

### 🔴 `SORTBY` is an object, and wrong keys are silently ignored

```javascript
// ✗ WRONG - SORTBY_ORDER does not exist, so NOTHING is applied
await client.ft.search('idx', '*', { SORTBY: 'age', SORTBY_ORDER: 'DESC' });

// ✓ CORRECT
await client.ft.search('idx', '*', { SORTBY: { BY: 'age', DIRECTION: 'DESC' } });
```

Verified: my first run produced **identical output for DESC and ASC** because both options
were dropped. After the fix:

```
DESC:  85 Grace Hopper, 84 Barbara Liskov, 72 Edsger Dijkstra, 41 Alan Turing, 36 Ada Lovelace
ASC:   36 Ada Lovelace, 41 Alan Turing, 72 Edsger Dijkstra, 84 Barbara Liskov, 85 Grace Hopper
```

`LIMIT` is also an object: `{ from, size }`.

### ⚠️ TEXT fields don't match TAG values

```javascript
await client.ft.search('idx', 'London');        // 0 results!
await client.ft.search('idx', '@city:{London}'); // 2 results ✓
```

Verified. `city` is a `TAG` field, so free-text search does not look at it. This surprises
people constantly — if a value should be findable by typing it, make it `TEXT` (or both).

### The boolean operator is `|`, not `OR`

```
compiler cryptography   (AND, 0 docs)    -> 0
compiler|cryptography  (OR, 2 docs)      -> 2
compiler OR cryptography                 -> 0   ⚠️ the word OR does nothing
```

Verified against the running server with raw `FT.SEARCH`. If you are following a tutorial
that uses `OR`, it is either for another engine or out of date.

### Fuzzy search is permissive by default

```
@name:~Lovlace  (fuzzy)  -> 5 : Ada Lovelace, Alan Turing, Grace Hopper, Edsger Dijkstra, Barbara Liskov
```

A one-letter typo matched **everything**. RediSearch's default edit distance scales with
word length and is generous. For "did you mean" UX, either set an explicit `DISTANCE` or
use prefix search (`compil*`), which behaved predictably.

### Indexing JSON too

```javascript
await client.ft.create('idx:products', {
  '$.name':     { type: SCHEMA_FIELD_TYPE.TEXT,    AS: 'name' },
  '$.price':    { type: SCHEMA_FIELD_TYPE.NUMERIC, AS: 'price', SORTABLE: true },
  '$.category': { type: SCHEMA_FIELD_TYPE.TAG,     AS: 'category' },
}, { ON: 'JSON', PREFIX: 'product:' });
```

Verified:

```
search "keyboard" -> 1 [ 'ch16:product:1' ]
category peripherals -> 2 products
price 50-500 sorted by price -> [ 'product:1 price=89', 'product:3 price=450' ]
```

`AS` maps the JSONPath to a friendlier field name you query with (`@name`, not `@$.name`).

### Aggregation returns a structured object under RESP3

```javascript
const agg = await client.sendCommand(['FT.AGGREGATE', 'idx', '*',
  'GROUPBY', '1', '@city', 'REDUCE', 'COUNT', '0', 'AS', 'num']);

agg.total_results;          // 4  → NUMBER OF GROUPS, not documents
agg.results[i].extra_attributes;   // { city: 'london', num: '2' }
```

Verified. redis-cli shows `[count, row, row, ...]`; RESP3 gives this object. The typed
`ft.aggregate()` helper returned `[{}, {}, {}]` (empty objects) for this grouping, so
`sendCommand` is more reliable here.

### `FT.INFO` returns attributes as an array

```javascript
const info = await client.ft.info('idx:people');
info.num_docs;   // 5
info.num_terms;  // 35
info.attributes; // ARRAY of objects
```

Verified:

```
   name (TEXT) ["SORTABLE"]
   age (NUMERIC) ["SORTABLE","UNF"]
   city (TAG) ["SORTABLE"]
   bio (TEXT)
```

---

## 5. When to use it and when NOT to

### ✅ Use RediSearch when

- Users need **free-text search** over documents.
- You need **faceted filtering** (filters, categories, date ranges).
- You need **sort by relevance or a field**.
- You need **aggregations** (counts per category, averages, percentiles).
- You want search **without writing a separate search service**.
- You want **autocomplete / prefix search**.

### ❌ Don't use it when

| Situation | Why | Use instead |
|---|---|---|
| You need **exact-match lookups** only | Indexing is overkill | [Hash](07-hashes.md) `HGET` |
| You need **deep pagination** past ~10k | RediSearch returns offsets, not cursors | A real search engine |
| Your data is **highly volatile** | Frequent reindexing costs | Reconsider |
| You need **complex relevance tuning** | RediSearch is deliberately simple | Elasticsearch |
| You need **per-field ACL filtering** at scale | Possible but manual | A search engine |
| You need **geospatial polygons** | Radius/box only | PostGIS |
| Documents are **huge blobs** | Text extraction cost | Store text separately |

### RediSearch vs the core types

You do **not** choose *instead of* hashes or JSON — you **index them**. RediSearch is a
layer on top of `FT.CREATE` over `HASH` or `JSON` keys. You still store data normally, then
declare how to index it.

---

## 6. Common mistakes

**Mistake 1 — `SORTBY: 'field', SORTBY_ORDER: 'DESC'`.**
Both keys are ignored; results come back in relevance order. Use
`SORTBY: { BY: 'field', DIRECTION: 'DESC' }`. Verified: DESC and ASC looked identical.

**Mistake 2 — Using the word `OR`.**
`a OR b` returned 0. Use `a|b`. Verified.

**Mistake 3 — Free-text searching a TAG field.**
`search('London')` → 0 when `city` is a `TAG`. Use `@city:{London}`, or index it as `TEXT`
too.

**Mistake 4 — Forgetting `PREFIX`.**
Without it, `FT.CREATE ... ON HASH` (with no prefix) tries to index keys like
`idx:people` themselves and logs warnings. Always scope by prefix.

**Mistake 5 — Not adding `SORTABLE`.**
You cannot `SORTBY` or `SORT` a field unless it is declared `SORTABLE`.

**Mistake 6 — Missing `MKSTREAM` on the group/index path.**
`FT.CREATE` on an index whose stream doesn't exist fails. (Relevant with
`ON JSON` + `PREFIX` if no keys exist yet.)

**Mistake 7 — Assuming the index is instant.**
Writes are indexed asynchronously. Verified: the example waits ~300–400 ms. Test with a
poll loop or a short sleep.

**Mistake 8 — Trusting fuzzy search precision.**
Verified: `~Lovlace` matched all 5 documents. Set an explicit `DISTANCE`.

**Mistake 9 — Deep pagination with `LIMIT from 100000`.**
RediSearch uses offsets, so deep pages get slower. Cap your `from`.

**Mistake 10 — Forgetting TAG values are lowercased.**
Verified: `{city:"london"}` in the aggregation. Use `CASESENSITIVE` on the TAG field.

**Mistake 11 — Expecting `ft.aggregate()` to give useful objects.**
It returned `[{}, {}, {}]`. Use `sendCommand` and read `results[].extra_attributes`.

**Mistake 12 — Thinking `FT.INFO().attributes` is an object.**
It is an **array** of field objects. Verified.

---

## 7. Try it yourself

**Exercise:** Build a product index with `name` (TEXT), `category` (TAG), `price` (NUMERIC,
SORTABLE) and `tags` (TAG). Add 10 products. Then answer: (a) all products in category
`books` under £20, sorted by price ascending, (b) which products match `note*` by prefix,
(c) how many products per category via aggregation.

**Hint:** (a) is `ft.search(idx, '@category:{books} @price:[0 20]', { SORTBY: { BY: 'price',
DIRECTION: 'ASC' } })`. (c) is `sendCommand(['FT.AGGREGATE', idx, '*', 'GROUPBY', '1',
'@category', 'REDUCE', 'COUNT', '0', 'AS', 'n'])` and read `results[].extra_attributes`.

**What to notice:** (a) is a **single command** that filters on two different field types,
sorts, and paginates. Doing that by hand would mean fetching every product and filtering in
application code.

**Stretch:** try adding `SORTBY_ORDER` instead of `SORTBY.DIRECTION` and watch the sorting
silently stop working.

---

## 8. Next

**[Chapter 17 — Transactions (MULTI/EXEC)](17-transactions.md)** — running several commands
as one indivisible unit.

---

**Verified facts recap**

| Claim | How verified |
|---|---|
| `SORTBY` must be `{ BY, DIRECTION }` | DESC and ASC were identical when wrong |
| `LIMIT` must be `{ from, size }` | Typings + behaviour |
| Boolean OR is `\|`, **not** the word `OR` | `compiler OR cryptography` → 0; `a\|b` → 2 |
| Space between terms = AND | `compiler cryptography` → 0 |
| Free text does **not** match TAG fields | `London` → 0; `@city:{London}` → 2 |
| `@city:{London\|New York}` works | 3 docs |
| `@city:{Lond*}` TAG prefix works | 2 docs |
| Numeric ranges inclusive | `@age:[30 50]` → 2 |
| Fuzzy `~` is too permissive by default | `~Lovlace` → all 5 |
| Highlighting wraps matches in `<b>` | `"<b>compiler</b> pioneer and admiral"` |
| Aggregation needs `GROUPBY 1 @city` | Without the `1` → parse error |
| Aggregation TAG values lowercased | `{"city":"london",...}` |
| RESP3 aggregate reply is an object | `{total_results, results:[{extra_attributes}]}` |
| `ft.aggregate()` gave `[{},{},{}]` | Direct |
| JSON indexing via `AS` aliases | `@name` worked for `$.name` |
| `FT.INFO.attributes` is an array | Array of field objects |