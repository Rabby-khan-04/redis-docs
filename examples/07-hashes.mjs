/**
 * Chapter 07 - Hashes
 * Run:  node examples/07-hashes.mjs
 */
import { createClient } from 'redis';

const client = createClient({ url: 'redis://127.0.0.1:6379' });
await client.connect();

const P = 'ch07:';
const keys = [];

// ---------------------------------------------------------------------------
// 1. A hash is a bag of field -> value pairs inside ONE key.
// ---------------------------------------------------------------------------
await client.hSet(P + 'user:1', { name: 'Ada', age: '36', city: 'London' });
keys.push(P + 'user:1');

console.log('--- basics ---');
console.log('HGET name        ->', await client.hGet(P + 'user:1', 'name'));
console.log('HLEN             ->', await client.hLen(P + 'user:1'));
console.log('HEXISTS name     ->', await client.hExists(P + 'user:1', 'name'));
console.log('HEXISTS nope     ->', await client.hExists(P + 'user:1', 'nope'));
console.log('HKEYS            ->', await client.hKeys(P + 'user:1'));
console.log('HVALS            ->', await client.hVals(P + 'user:1'));
console.log('HGETALL          ->', await client.hGetAll(P + 'user:1'));
console.log('missing field    ->', await client.hGet(P + 'user:1', 'nope'), '(null, not an error)');
console.log('missing key      ->', await client.hGetAll(P + 'ghost'), '(empty object, not an error)');

// ---------------------------------------------------------------------------
// 2. The whole point: change ONE field without rewriting the record.
// ---------------------------------------------------------------------------
console.log('\n--- partial update ---');
await client.hSet(P + 'user:1', 'city', 'Paris');            // only this field changes
console.log('after city=Paris ->', await client.hGet(P + 'user:1', 'city'));
console.log('name untouched    ->', await client.hGet(P + 'user:1', 'name'));

console.log('HINCRBY age 1    ->', await client.hIncrBy(P + 'user:1', 'age', 1));
console.log('HDEL city        ->', await client.hDel(P + 'user:1', 'city'));
console.log('HLEN after HDEL  ->', await client.hLen(P + 'user:1'));
await client.del(keys.splice(0));

// ---------------------------------------------------------------------------
// 3. A string holding JSON vs a hash
// ---------------------------------------------------------------------------
console.log('\n--- string+JSON vs hash ---');
const record = { name: 'Ada', age: 36, city: 'London' };

// String: whole blob must be read, parsed, changed, re-serialised.
await client.set(P + 'as:string', JSON.stringify(record)); keys.push(P + 'as:string');
const parsed = JSON.parse(await client.get(P + 'as:string'));
parsed.age += 1;
await client.set(P + 'as:string', JSON.stringify(parsed));
console.log('string version ->', await client.get(P + 'as:string'));

// Hash: one field, one command.
await client.hSet(P + 'as:hash', { name: 'Ada', age: '36', city: 'London' }); keys.push(P + 'as:hash');
await client.hIncrBy(P + 'as:hash', 'age', 1);
console.log('hash version   ->', await client.hGetAll(P + 'as:hash'));
console.log('read ONE field ->', await client.hGet(P + 'as:hash', 'name'), '(no parsing needed)');

// ---------------------------------------------------------------------------
// 4. Internal encoding: listpack vs hashtable. The 513-field cliff.
// ---------------------------------------------------------------------------
console.log('\n--- encoding cliff ---');
const entries = await client.configGet('hash-max-listpack-entries');
const valueLen = await client.configGet('hash-max-listpack-value');
console.log('hash-max-listpack-entries :', entries['hash-max-listpack-entries']);
console.log('hash-max-listpack-value   :', valueLen['hash-max-listpack-value']);

await client.hSet(P + 'small', { a: '1', b: '2' });
console.log('2 fields   ->', await client.objectEncoding(P + 'small'),
            `(${await client.memoryUsage(P + 'small')} bytes)`);

// Walk up to the threshold and watch it convert.
await client.del(P + 'big');
let flipped = null;
for (let i = 0; i < 600; i++) {
  await client.hSet(P + 'big', 'f' + i, 'v' + i);
  if (!flipped && (await client.objectEncoding(P + 'big')) !== 'listpack') {
    flipped = i + 1;
  }
}
console.log('600 fields  ->', await client.objectEncoding(P + 'big'),
            `(${await client.memoryUsage(P + 'big')} bytes)`);
console.log('converted to hashtable at', flipped, 'fields');
console.log('  ^ the conversion is a full rebuild -- a one-off latency spike at 513 fields');
keys.push(P + 'small', P + 'big');

// ---------------------------------------------------------------------------
// 5. Field-level TTL (Redis 7.4+) -- the thing strings cannot do
// ---------------------------------------------------------------------------
console.log('\n--- field-level TTL ---');
await client.hSet(P + 'session', { token: 'abc', csrf: 'xyz', flash: 'Welcome!' });
keys.push(P + 'session');
console.log('HGET flash (no field TTL) ->', await client.hGet(P + 'session', 'flash'));

// NOTE: node-redis adds the "FIELDS numfields" prefix for you, so you pass
// just the field names as an array. Raw redis-cli DOES need the FIELDS keyword:
//   HTTL key FIELDS 1 flash
console.log('HTTL before               ->', await client.hTTL(P + 'session', ['flash']));
console.log('HEXPIRE flash 2s          ->', await client.hExpire(P + 'session', ['flash'], 2));
console.log('HTTL after                ->', await client.hTTL(P + 'session', ['flash']));
console.log('HTTL several fields       ->', await client.hTTL(P + 'session', ['flash', 'token']));
console.log('HGETALL (flash still here)->', await client.hGetAll(P + 'session'));

await new Promise(r => setTimeout(r, 2300));
console.log('HGETALL after 2.3s        ->', await client.hGetAll(P + 'session'));
console.log('  ^ only the expired FIELD vanished; token and csrf are untouched');
console.log('HTTL on now-missing field ->', await client.hTTL(P + 'session', ['flash']), '(-2)');

// hash-level TTL still works too
await client.expire(P + 'session', 100);
console.log('key-level TTL             ->', await client.ttl(P + 'session'));

// ---------------------------------------------------------------------------
// 6. HSCAN -- safe iteration over a big hash
// ---------------------------------------------------------------------------
// IMPORTANT: hScanIterator yields BATCHES (arrays of {field,value}), one array
// per round trip -- NOT one entry at a time.
console.log('\n--- HSCAN ---');
const all = await client.hGetAll(P + 'big');
console.log('HGETALL returns', Object.keys(all).length, 'fields at once (O(N))');
let batches = 0, seen = 0;
for await (const batch of client.hScanIterator(P + 'big', { COUNT: 100 })) {
  batches++;
  seen += batch.length;          // each batch is an ARRAY of { field, value }
}
console.log(`hScanIterator walked ${seen} fields in ${batches} batches without blocking`);
console.log('  (batches match the manual HSCAN round-trips; nothing is lost)');

// manual loop for comparison -- hScan takes (key, cursor, options)
let cursor = '0', manual = 0, rounds = 0;
do {
  const r = await client.hScan(P + 'big', cursor, { COUNT: 100 });
  cursor = r.cursor;
  rounds++;
  manual += r.entries.length;
} while (cursor !== '0');
console.log(`manual HSCAN loop     -> ${manual} fields in ${rounds} rounds (identical)`);

// ---------------------------------------------------------------------------
// 7. HSCAN MATCH and COUNT
// ---------------------------------------------------------------------------
console.log('\n--- HSCAN options ---');
let matchCount = 0, matchBatches = 0;
for await (const batch of client.hScanIterator(P + 'big', { MATCH: 'f1?', COUNT: 50 })) {
  matchBatches++;
  matchCount += batch.length;
}
console.log(`hScanIterator MATCH 'f1?' -> ${matchCount} fields in ${matchBatches} batches (server-side filter)`);

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------
await client.del(keys);
console.log('\nDBSIZE after cleanup:', await client.dbSize());
await client.close();