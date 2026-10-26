/**
 * Chapter 13 - Geospatial indexes
 * Run:  node examples/13-geospatial.mjs
 */
import { createClient } from 'redis';

const client = createClient({ url: 'redis://127.0.0.1:6379' });
await client.connect();

const P = 'ch13:';
const keys = [];

// ---------------------------------------------------------------------------
// 1. Add places. ⚠️ The order is LONGITUDE first, then latitude!
// ---------------------------------------------------------------------------
// ⚠️ geoAdd takes an ARRAY of { longitude, latitude, member }
await client.geoAdd(P + 'Sicily', [
  { longitude: 13.361389, latitude: 38.115556, member: 'Palermo' },
  { longitude: 15.087269, latitude: 37.502669, member: 'Catania' },
]);
keys.push(P + 'Sicily');

console.log('--- basics ---');
console.log('TYPE        ->', await client.type(P + 'Sicily'), '  (a GEO set IS a sorted set!)');
console.log('GEOPOS Palermo ->', await client.geoPos(P + 'Sicily', 'Palermo'));
console.log('ZSCORE Palermo ->', await client.zScore(P + 'Sicily', 'Palermo'),
            '  (the 52-bit geohash score)');

// ---------------------------------------------------------------------------
// 2. Distance
// ---------------------------------------------------------------------------
console.log('\n--- distance ---');
console.log('GEODIST (metres) ->', await client.geoDist(P + 'Sicily', 'Palermo', 'Catania'));
console.log('GEODIST km       ->', await client.geoDist(P + 'Sicily', 'Palermo', 'Catania', 'km'));
console.log('GEODIST missing  ->', await client.geoDist(P + 'Sicily', 'Palermo', 'Nowhere'));

// ---------------------------------------------------------------------------
// 3. Search by radius from raw coordinates
// ---------------------------------------------------------------------------
console.log('\n--- GEOSEARCH by radius from a point ---');
console.log('within 200km of (15,37) ->',
  await client.geoSearch(P + 'Sicily',
    { longitude: 15, latitude: 37 },
    { radius: 200, unit: 'km' },
    { SORT: 'ASC' }));

// With distances you need sendCommand: the typed API only takes SORT and COUNT.
console.log('...with distances ->',
  await client.sendCommand(['GEOSEARCH', P + 'Sicily', 'FROMLONLAT', '15', '37',
    'BYRADIUS', '200', 'km', 'ASC', 'WITHDIST']));

// ---------------------------------------------------------------------------
// 4. Search by radius from an existing member
// ---------------------------------------------------------------------------
console.log('\n--- GEOSEARCH from a member ---');
console.log('within 200km of Palermo ->',
  await client.geoSearch(P + 'Sicily', 'Palermo',
    { radius: 200, unit: 'km' },
    { SORT: 'ASC' }));

// ---------------------------------------------------------------------------
// 5. Search by bounding box
// ---------------------------------------------------------------------------
console.log('\n--- GEOSEARCH by box (width x height) ---');
console.log('400x400km box around (15,37) ->',
  await client.sendCommand(['GEOSEARCH', P + 'Sicily', 'FROMLONLAT', '15', '37',
    'BYBOX', '400', '400', 'km', 'ASC', 'WITHCOORD']));

// ---------------------------------------------------------------------------
// 6. COUNT limits the number of results
// ---------------------------------------------------------------------------
console.log('\n--- COUNT ---');
console.log('nearest 1 only ->',
  await client.sendCommand(['GEOSEARCH', P + 'Sicily', 'FROMLONLAT', '15', '37',
    'BYRADIUS', '500', 'km', 'ASC', 'COUNT', '1']));

// ---------------------------------------------------------------------------
// 7. Real use: find the nearest N places to a user
// ---------------------------------------------------------------------------
console.log('\n--- real use: nearest 3 coffee shops to a user ---');
const user = { longitude: 13.38, latitude: 38.12 };   // roughly Palermo
await client.del(P + 'shops');
await client.geoAdd(P + 'shops', [
  { longitude: 13.361389, latitude: 38.115556, member: 'Bar Centrale' },
  { longitude: 13.370000, latitude: 38.120000, member: 'Caffè Napoli' },
  { longitude: 13.350000, latitude: 38.110000, member: 'Bar Verga' },
  { longitude: 15.087269, latitude: 37.502669, member: 'Bar Catania' },
]); keys.push(P + 'shops');

const near = await client.sendCommand(['GEOSEARCH', P + 'shops', 'FROMLONLAT',
  String(user.longitude), String(user.latitude), 'BYRADIUS', '50', 'km', 'ASC',
  'COUNT', '3', 'WITHDIST']);
console.log('nearest 3 within 50km:');
// Under RESP3 each result is a nested pair: [ [name, dist], [name, dist], ... ]
for (const [name, dist] of near) {
  console.log(`  ${String(name).padEnd(14)} ${Number(dist).toFixed(2)} km`);
}

// ---------------------------------------------------------------------------
// 8. 🔴 The 52-bit precision trap
// ---------------------------------------------------------------------------
console.log('\n--- ⚠️ 52-bit precision limit ---');
await client.del(P + 'tiny');
// Two points about 15 CENTIMETRES apart.
await client.geoAdd(P + 'tiny', [
  { longitude: 13.361389, latitude: 38.115556, member: 'A' },
  { longitude: 13.361390, latitude: 38.115557, member: 'B' },
]); keys.push(P + 'tiny');

const scoreA = await client.zScore(P + 'tiny', 'A');
const scoreB = await client.zScore(P + 'tiny', 'B');
console.log('score of A ->', scoreA);
console.log('score of B ->', scoreB);
console.log('identical?  ->', scoreA === scoreB, '  ← both collapsed into one 52-bit geohash');
console.log('GEODIST A B ->', await client.geoDist(P + 'tiny', 'A', 'B'), 'metres (reported as zero)');
console.log('  Redis stores a 52-bit integer, not a float. Precision is roughly ±0.5 m.');
console.log('  Fine for cities and shops. NOT fine for survey or asset tracking.');

// ---------------------------------------------------------------------------
// 9. GEOHASH
// ---------------------------------------------------------------------------
console.log('\n--- GEOHASH ---');
console.log('GEOHASH Palermo ->', await client.geoHash(P + 'Sicily', ['Palermo']));
console.log('  (geohashes are base32 strings; nearby places share a prefix)');
console.log('GEOHASH of a missing member ->', await client.geoHash(P + 'Sicily', ['Nowhere']));

// ---------------------------------------------------------------------------
// 10. Editing and removing
// ---------------------------------------------------------------------------
console.log('\n--- edit / remove ---');
await client.geoAdd(P + 'Sicily', { longitude: 13.40, latitude: 38.12, member: 'Palermo' });
console.log('after moving Palermo ->', await client.geoPos(P + 'Sicily', 'Palermo'));
console.log('ZREM Palermo        ->', await client.zRem(P + 'Sicily', 'Palermo'), '(it is just a sorted set)');
console.log('ZSCORE Palermo      ->', await client.zScore(P + 'Sicily', 'Palermo'));
await client.geoAdd(P + 'Sicily', { longitude: 13.361389, latitude: 38.115556, member: 'Palermo' });

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------
await client.del(keys);
console.log('\nDBSIZE after cleanup:', await client.dbSize());
await client.close();