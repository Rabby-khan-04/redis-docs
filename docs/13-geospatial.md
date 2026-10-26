# Chapter 13 — Geospatial indexes

> **Verified on:** Redis **8.10.2**, node-redis **6.3.0**
> Run the code: `node examples/13-geospatial.mjs`

---

## 1. Simple explanation (like I'm 7)

Imagine a **map**. You want to ask:

- "Which coffee shops are within 2 km of me?"
- "How far is it from Palermo to Catania?"
- "What is the **nearest** 3 restaurants?"

Redis can answer these if you give it latitude and longitude for each place. It works out
the distances itself — you don't need to write any trigonometry.

---

## 2. Real name

A **geo set** is a **sorted set** whose **score is a 52-bit geohash**, not a number you
choose.

```redis
GEOADD Sicily 13.361389 38.115556 "Palermo"
```

Verified: `TYPE Sicily` → **`zset`**. The score for Palermo is `3479099956230698` — that is
the geohash packed into an integer. Everything about geo commands falls out of that one
design choice.

### Commands

| Command | Cost | What it does |
|---|---|---|
| `GEOADD key lon lat member...` | O(log N) each | Add/update places |
| `GEOSEARCH key <center> <search> [opts]` | O(log N + M) | Find places nearby |
| `GEOSEARCHSTORE` / `GEORADIUS_RO` | — | Variants |
| `GEODIST key m1 m2 [unit]` | O(log N) | Distance between two members |
| `GEOPOS key member...` | O(log N) | Read back coordinates |
| `GEOHASH key member...` | O(log N) | The geohash string |

### ⚠️ GEOADD takes **longitude first**, then latitude

This is the single most common geo bug. GeoJSON, Google Maps and most APIs use
**lat, lon**. Redis uses **lon, lat**.

```javascript
// ✗ WRONG - somewhere in the Indian Ocean
{ latitude: 38.115556, longitude: 13.361389 }   // order swapped = wrong place

// ✓ Redis wants an object, but it maps to lon,lat on the wire
{ longitude: 13.361389, latitude: 38.115556, member: 'Palermo' }
```

Passing an object avoids the ordering mistake entirely, because the keys are named.

### Search centers and shapes

| Center | Syntax |
|---|---|
| Raw coordinates | `FROMLONLAT <lon> <lat>` |
| An existing member | `FROMMEMBER <name>` |

| Shape | Syntax |
|---|---|
| Radius | `BYRADIUS <r> <unit>` |
| Bounding box | `BYBOX <width> <height> <unit>` |

Units: `m`, `km`, `mi`, `ft`.

Options: `ASC`/`DESC`, `COUNT n [ANY]`, `WITHDIST`, `WITHCOORD`, `WITHHASH`.

---

## 3. redis-cli example

```bash
docker exec -it redis-learn redis-cli
```

```redis
127.0.0.1:6379> GEOADD Sicily 13.361389 38.115556 "Palermo"
(integer) 1
127.0.0.1:6379> GEOADD Sicily 15.087269 37.502669 "Catania"
(integer) 1

127.0.0.1:6379> TYPE Sicily
zset                        ← a geo set IS a sorted set
127.0.0.1:6379> ZSCORE Sicily Palermo
"3479099956230698"          ← the geohash score

127.0.0.1:6379> GEODIST Sicily Palermo Catania
"166274.1516"               ← metres by default
127.0.0.1:6379> GEODIST Sicily Palermo Catania km
"166.2742"

127.0.0.1:6379> GEOPOS Sicily Palermo
1) 1) "13.361389338970184"
   2) "38.1155563954963"
```

### Search by radius

```redis
127.0.0.1:6379> GEOSEARCH Sicily FROMLONLAT 15 37 BYRADIUS 200 km ASC
1) "Catania"
2) "Palermo"

127.0.0.1:6379> GEOSEARCH Sicily FROMLONLAT 15 37 BYRADIUS 200 km ASC WITHDIST
1) 1) "Catania"
   2) "56.4413"
2) 1) "Palermo"
   2) "190.4424"
```

### Search from a member, and by box

```redis
127.0.0.1:6379> GEOSEARCH Sicily FROMMEMBER Palermo BYRADIUS 200 km ASC
1) "Palermo"
2) "Catania"

127.0.0.1:6379> GEOSEARCH Sicily FROMLONLAT 15 37 BYBOX 400 400 km ASC WITHCOORD
1) 1) "Catania"
   2) 1) "15.087267458438873"
      2) "37.50266842333162"
2) 1) "Palermo"
   2) 1) "13.361389338970184"
      2) "38.1155563954963"
```

---

## 4. Node.js example

### Verified output of `examples/13-geospatial.mjs`

```
--- basics ---
TYPE        -> zset   (a GEO set IS a sorted set!)
GEOPOS Palermo -> [ { longitude: 13.361389338970184, latitude: 38.1155563954963 } ]
ZSCORE Palermo -> 3479099956230698   (the 52-bit geohash score)

--- distance ---
GEODIST (metres) -> 166274.1516
GEODIST km       -> 166.2742
GEODIST missing  -> null

--- GEOSEARCH by radius from a point ---
within 200km of (15,37) -> [ 'Catania', 'Palermo' ]
...with distances -> [ [ 'Catania', '56.4413' ], [ 'Palermo', '190.4424' ] ]

--- GEOSEARCH from a member ---
within 200km of Palermo -> [ 'Palermo', 'Catania' ]

--- GEOSEARCH by box (width x height) ---
400x400km box around (15,37) -> [
  [ 'Catania', [ 15.087267458438873, 37.50266842333162 ] ],
  [ 'Palermo', [ 13.361389338970184, 38.1155563954963 ] ]
]

--- COUNT ---
nearest 1 only -> [ 'Catania' ]

--- real use: nearest 3 coffee shops to a user ---
nearest 3 within 50km:
  Caffè Napoli   0.88 km
  Bar Centrale   1.70 km
  Bar Verga      2.85 km

--- ⚠️ 52-bit precision limit ---
score of A -> 3479099956230698
score of B -> 3479099956230698
identical?  -> true   ← both collapsed into one 52-bit geohash
GEODIST A B -> 0 metres (reported as zero)
  Redis stores a 52-bit integer, not a float. Precision is roughly ±0.5 m.
  Fine for cities and shops. NOT fine for survey or asset tracking.

--- GEOHASH ---
GEOHASH Palermo -> [ 'sqc8b49rny0' ]
  (geohashes are base32 strings; nearby places share a prefix)
GEOHASH of a missing member -> [ null ]

--- edit / remove ---
after moving Palermo -> [ { longitude: 13.400002419948578, latitude: 38.119999761688625 } ]
ZREM Palermo        -> 1 (it is just a sorted set)
ZSCORE Palermo      -> null

DBSIZE after cleanup: 0
```

### The API takes objects, which prevents the lon/lat mistake

```javascript
await client.geoAdd('Sicily', [
  { longitude: 13.361389, latitude: 38.115556, member: 'Palermo' },
  { longitude: 15.087269, latitude: 37.502669, member: 'Catania' },
]);
```

⚠️ The array is **required** — `geoAdd(key, {longitude, latitude, member})` with varargs
silently drops the extras, same trap as lists and sets
([Chapter 08](08-lists.md)).

### The typed `geoSearch` has fewer options than the command

```javascript
// typed API: only SORT and COUNT
await client.geoSearch('Sicily', { longitude: 15, latitude: 37 },
                      { radius: 200, unit: 'km' }, { SORT: 'ASC' });

// for WITHDIST / WITHCOORD you need sendCommand
await client.sendCommand(['GEOSEARCH', 'Sicily', 'FROMLONLAT', '15', '37',
  'BYRADIUS', '200', 'km', 'ASC', 'WITHDIST']);
```

Verified: `WITHCOORD` gives nested `[ [name, [lon, lat]], ... ]`; `WITHDIST` gives
`[ [name, dist], ... ]`.

### 🔴 The 52-bit precision trap, demonstrated

```javascript
// Two points about 15 CENTIMETRES apart
await client.geoAdd('tiny', [
  { longitude: 13.361389, latitude: 38.115556, member: 'A' },
  { longitude: 13.361390, latitude: 38.115557, member: 'B' },
]);
```

```
score of A -> 3479099956230698
score of B -> 3479099956230698
identical?  -> true   ← both collapsed into one 52-bit geohash
GEODIST A B -> 0 metres (reported as zero)
```

Both points produce the **identical score**, and `GEODIST` reports them as
**0 metres apart**. Redis quantises coordinates into a 52-bit geohash, so anything finer
than roughly ±0.5 m is lost.

**Perfect for** finding restaurants, delivery drivers, or nearby stores.
**Useless for** survey markers, asset tracking to the centimetre, or drone navigation.

### Geo sets are just sorted sets

```javascript
await client.zRem('Sicily', 'Palermo');       // remove a place
await client.zScore('Sicily', 'Palermo');     // its geohash
await client.zRange('Sicily', 0, -1);          // members ordered by geohash
```

Verified: `ZREM` returned `1` and the subsequent `ZSCORE` was `null`.

⚠️ Don't abuse `ZRANGE` ordering — geohash order is not geographic order. It happens to
correlate, but it is not meaningful.

---

## 5. When to use it and when NOT to

### ✅ Use a geo index when

- **"Find nearby"** queries: restaurants, stores, drivers, events.
- **Distance** between two known places.
- **Geofencing**: "notify me when a courier enters this postcode area".
- **Delivery** zones and radius filtering.
- Anything needing **sort by distance** over a large set.

### ❌ Don't use it when

| Situation | Why | Use instead |
|---|---|---|
| You need **sub-metre** precision | 52-bit geohash quantises to ~0.5 m | PostGIS, a real GIS |
| You need **polygon** containment ("inside this shape") | No polygon support | PostGIS (`ST_Contains`) |
| You need **routing** / turn-by-turn | Not a routing engine | A routing service |
| You need **time zones**, geocoding (address → coords) | Not supported | An external API |
| You need **elevation** or terrain | Not supported | External data |
| Very few points (< a few dozen) | A set of lat/lon strings is fine | [Hash](07-hashes.md) |

### Approximate radius vs bounding box

| | `BYRADIUS` | `BYBOX` |
|---|---|---|
| Shape | Circle | Rectangle |
| "Within 2 km" | ✅ Exact | ❌ |
| "In this map viewport" | ❌ | ✅ ✅ |
| Use for | distance queries | map screens |

They compose well: use `BYBOX` to limit candidates for a map viewport, then `BYRADIUS` for
the real check.

---

## 6. Common mistakes

**Mistake 1 — Swapping longitude and latitude.**
The classic. Redis is **lon, lat**. Use the object form so the keys are named.

**Mistake 2 — The geoAdd varargs trap.**
`geoAdd(key, {..}, {..})` stores only the first. Pass an **array**.

**Mistake 3 — Expecting the typed `geoSearch` to support `WITHDIST`.**
`GeoSearchOptions` only has `SORT` and `COUNT`. Use `sendCommand`.

**Mistake 4 — Needing more precision than 52 bits.**
Verified: two points 15 cm apart collapsed to the same score and reported 0 m apart.

**Mistake 5 — Assuming `GEODIST` works with raw coordinates.**
`geoDist(key, m1, m2, unit)` takes **two member names**. For a distance from a raw point,
use `GEOSEARCH ... WITHDIST`.

**Mistake 6 — Not adding both coordinates when updating.**
`GEOADD` **replaces** the position of an existing member. Verified: moving Palermo to
13.40/38.12 updated it.

**Mistake 7 — `BYBOX` arguments swapped.**
`BYBOX <width> <height> <unit>` — width first.

**Mistake 8 — Missing `ASC` for "nearest first".**
Default order is **unspecified**. Always add `ASC` when you want nearest-first.

**Mistake 9 — No `COUNT` on a huge geo set.**
`GEOSEARCH` without `COUNT` can return hundreds of thousands of members and block the
server. Always limit.

**Mistake 10 — Using `ZRANGE` for geo ordering.**
The score is a geohash, not a distance from anything meaningful.

---

## 7. Try it yourself

**Exercise:** Add 20 coffee shops scattered around a city (invent coordinates). Then find
(a) the 5 nearest to a user, (b) how many are within 1 km, and (c) the distance from the
nearest shop to the farthest.

**Hint:** `geoAdd` them all in one array call. For (a),
`sendCommand(['GEOSEARCH', key, 'FROMLONLAT', lon, lat, 'BYRADIUS', '50', 'km', 'ASC',
'COUNT', '5', 'WITHDIST'])`. For (b) count the results. For (c) take the last `WITHDIST`
value.

**What to notice:** everything is **one command each**, regardless of how many shops
exist — because the data is a sorted set ordered by geohash.

**Stretch:** add two shops 10 cm apart and watch them collapse to the same score.

---

## 8. Next

**[Chapter 14 — Streams](14-streams.md)** — append-only logs with consumer groups, the
right way to build a job queue you cannot afford to lose.

---

**Verified facts recap**

| Claim | How verified |
|---|---|
| A geo set is a **sorted set** | `TYPE Sicily` → `zset` |
| Score is a 52-bit geohash | `ZSCORE` → `3479099956230698` |
| `GEODIST` default unit is **metres** | `166274.1516` vs `166.2742` km |
| `GEODIST` on a missing member → `null` | Direct |
| `GEOSEARCH ... WITHDIST` → `[[name, dist], ...]` | Direct |
| `GEOSEARCH ... WITHCOORD` → `[[name, [lon,lat]], ...]` | Direct |
| Typed `geoSearch` supports only SORT/COUNT | Typings + behaviour |
| Two points 15 cm apart → **identical score**, `GEODIST` = 0 | Demonstrated |
| `geoAdd` requires an array | Varargs stores only the first |
| `ZREM` removes a geo member | Returned `1` |
| `GEOHASH` returns a base32 string | `sqc8b49rny0` |