/**
 * Chapter 12 - HyperLogLog and Bloom filters
 * Run:  node examples/12-hyperloglog-and-bloom.mjs
 *
 * HyperLogLog and Bloom filters are PROBABILISTIC: they trade a little accuracy
 * for a huge memory saving. Both are core (HLL) or module (Bloom) commands.
 */
import { createClient } from 'redis';
import bloom from '@redis/bloom';

const client = createClient({ url: 'redis://127.0.0.1:6379', modules: { bloom } });
await client.connect();

const P = 'ch12:';
const keys = [];

// ---------------------------------------------------------------------------
// 1. HyperLogLog: count distinct things in ~12 KB
// ---------------------------------------------------------------------------
console.log('--- HyperLogLog basics ---');
await client.pfAdd(P + 'hll', ['a', 'b', 'c']); keys.push(P + 'hll');
console.log('PFADD a b c  -> PFCOUNT:', await client.pfCount(P + 'hll'));
console.log('PFADD a again (duplicate) ->', await client.pfAdd(P + 'hll', ['a']));
console.log('PFCOUNT      ->', await client.pfCount(P + 'hll'), '(unchanged - sets are distinct-only)');

console.log('\nHLL is stored as a string:');
console.log('  TYPE        ->', await client.type(P + 'hll'));
console.log('  STRLEN      ->', await client.strLen(P + 'hll'), 'bytes');
console.log('  MEMORY USAGE->', await client.memoryUsage(P + 'hll'), 'bytes');

// ---------------------------------------------------------------------------
// 2. ⭐ The headline number: accuracy vs memory on 100,000 items
// ---------------------------------------------------------------------------
console.log('\n--- accuracy and memory on 100,000 distinct items ---');
const N = 100_000;
await client.del([P + 'hll100k', P + 'set100k']);

for (let i = 0; i < N; i++) await client.pfAdd(P + 'hll100k', [`user:${i}`]);
const hllEstimate = await client.pfCount(P + 'hll100k');

for (let i = 0; i < N; i++) await client.sAdd(P + 'set100k', [`user:${i}`]);
const exact = await client.sCard(P + 'set100k');

const hllMem = await client.memoryUsage(P + 'hll100k');
const setMem = await client.memoryUsage(P + 'set100k');
const err = ((hllEstimate - exact) / exact * 100).toFixed(3);

console.log(`  exact (SET)     : ${exact}`);
console.log(`  HLL estimate    : ${hllEstimate}`);
console.log(`  error           : ${err}%`);
console.log(`  SET memory      : ${setMem.toLocaleString()} bytes`);
console.log(`  HLL memory      : ${hllMem.toLocaleString()} bytes`);
console.log(`  saving          : ${(setMem / hllMem).toFixed(0)}x smaller`);

// ---------------------------------------------------------------------------
// 3. HLL merging -- the reason HLL exists
// ---------------------------------------------------------------------------
console.log('\n--- PFMERGE: union counts from separate HLLs ---');
await client.del(P + 'h1', P + 'h2', P + 'merged');
await client.pfAdd(P + 'h1', ['x', 'y', 'z']);
await client.pfAdd(P + 'h2', ['z', 'w']);
console.log('h1 PFCOUNT ->', await client.pfCount(P + 'h1'));
console.log('h2 PFCOUNT ->', await client.pfCount(P + 'h2'));
await client.pfMerge(P + 'merged', [P + 'h1', P + 'h2']); keys.push(P + 'merged');
console.log('merged PFCOUNT ->', await client.pfCount(P + 'merged'), '(union: x,y,z,w)');
console.log('PFCOUNT of several keys at once ->', await client.pfCount([P + 'h1', P + 'h2']));
console.log('  ^ one round trip for a cross-set distinct count');
keys.push(P + 'h1', P + 'h2');

// ---------------------------------------------------------------------------
// 4. ⚠️ HLL is NOT exact -- and you cannot delete from it
// ---------------------------------------------------------------------------
console.log('\n--- ⚠️ the limits of HyperLogLog ---');
console.log('  * PFCOUNT returns an ESTIMATE. Never use it for billing or quotas.');
console.log('  * Standard error is ~0.81%. Small counts are less accurate.');
console.log('  * You cannot PFREMOVE a single element (no PFDEL in core Redis).');
console.log('  * Comparing two HLLs for equality is not supported.');
await client.del(P + 'tiny');
await client.pfAdd(P + 'tiny', ['only']);
console.log('  tiny HLL (1 item) PFCOUNT ->', await client.pfCount(P + 'tiny'),
            '(estimate can be off even at tiny sizes)');

// ---------------------------------------------------------------------------
// 5. Bloom filters: "definitely not here" vs "maybe here"
// ---------------------------------------------------------------------------
console.log('\n--- Bloom filter ---');
await client.sendCommand(['BF.RESERVE', P + 'bf', '0.01', '1000']);
keys.push(P + 'bf');

await client.bf.add(P + 'bf', 'redis');
await client.bf.add(P + 'bf', 'nosql');
console.log('BF.ADD redis   -> added');
console.log('BF.ADD nosql   -> added');
console.log('BF.EXISTS redis->', await client.bf.exists(P + 'bf', 'redis'), '(1 = probably present)');
console.log('BF.EXISTS mongo->', await client.bf.exists(P + 'bf', 'mongo'), '(0 = DEFINITELY absent)');
console.log('BF.MEXISTS redis,mongo ->', await client.bf.mExists(P + 'bf', ['redis', 'mongo']));
console.log('BF.CARD ->', await client.bf.card(P + 'bf'), '(approximate count inserted)');

const info = await client.sendCommand(['BF.INFO', P + 'bf']);
console.log('\nBF.INFO (RESP3 map -> plain JS object):');
for (const [k, v] of Object.entries(info)) console.log(`  ${k}: ${v}`);

// ---------------------------------------------------------------------------
// 6. ⭐ Bloom false-positive rate, measured
// ---------------------------------------------------------------------------
// ⚠️ BF.EXISTS returns a BOOLEAN under RESP3 (true/false), not 1/0.
//    Comparing with === 1 silently reports 0% false positives forever.
console.log('\n--- false positives, measured (10,000 inserted, 10,000 absent lookups) ---');
for (const [errRate, label] of [['0.05', '5%'], ['0.01', '1%'], ['0.001', '0.1%']]) {
  const k = `${P}bf${errRate.replace('.', '')}`;
  await client.sendCommand(['BF.RESERVE', k, errRate, '10000']); keys.push(k);
  for (let i = 0; i < 10000; i++) await client.sendCommand(['BF.ADD', k, `present:${i}`]);
  let fp = 0;
  for (let i = 0; i < 10000; i++) {
    if (await client.sendCommand(['BF.EXISTS', k, `absent:${i}`]) === true) fp++;   // === true !
  }
  const bits = (await client.sendCommand(['BF.INFO', k])).Size;
  console.log(`  target ${label.padStart(5)}: ${String(fp).padStart(4)}/10000 false positives = ${(fp / 100).toFixed(2)}%` +
              `  (${String(bits).padStart(5)} bits, ${await client.memoryUsage(k)} bytes)`);
}
console.log('  ^ a tighter error rate costs MORE memory. Trade-off, not free.');

// ---------------------------------------------------------------------------
// 7. Bloom without RESERVE, and the other Bloom commands
// ---------------------------------------------------------------------------
console.log('\n--- Bloom without RESERVE (auto-sizing) ---');
await client.del([P + 'auto', P + 'bf', P + 'tiny']);
await client.bf.add(P + 'auto', 'first'); keys.push(P + 'auto');
const autoInfo = await client.sendCommand(['BF.INFO', P + 'auto']);
console.log('BF.ADD without RESERVE works, it grows automatically');
console.log('BF.INFO ->', `Capacity=${autoInfo.Capacity} Size=${autoInfo.Size} items=${autoInfo['Number of items inserted']}`);

console.log('\nBF.RESERVE lets you pick error rate + capacity UP FRONT:');
console.log('  BF.RESERVE key <error_rate> <capacity>');

// ---------------------------------------------------------------------------
// 8. The real use case: skip the database
// ---------------------------------------------------------------------------
console.log('\n--- the point: avoiding a database hit ---');
// The real pattern: a Bloom filter of every ID that exists in the database.
// Checked after every insert, or rebuilt periodically from the DB.
const dbIds = ['user-42', 'user-7', 'user-1234'];
await client.del(P + 'dbids');
await client.sendCommand(['BF.RESERVE', P + 'dbids', '0.01', '10000']); keys.push(P + 'dbids');
for (const id of dbIds) await client.sendCommand(['BF.ADD', P + 'dbids', id]);

async function lookup(id) {
  const maybe = await client.sendCommand(['BF.EXISTS', P + 'dbids', id]);
  if (maybe !== true) return { result: null, note: 'skipped the database entirely' };
  const row = dbIds.includes(id) ? { name: 'Ada', age: 36 } : null;   // pretend DB call
  return { result: row, note: row ? 'found' : 'false positive: wasted a DB query' };
}

console.log('user-42   ->', await lookup('user-42'));
console.log('user-9999 ->', await lookup('user-9999'));
console.log('  ^ most lookups never touch the database at all');

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------
await client.del([...keys, P + 'hll100k', P + 'set100k']);
console.log('\nDBSIZE after cleanup:', await client.dbSize());
await client.close();