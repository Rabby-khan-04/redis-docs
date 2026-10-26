/**
 * Chapter 28 - Performance best practices
 * Run:  node examples/28-performance-best-practices.mjs
 */
import { createClient } from 'redis';

const client = createClient({ url: 'redis://127.0.0.1:6379' });
await client.connect();

const P = 'ch28:';
const keys = [];

const ms = (t) => (Number(process.hrtime.bigint() - t) / 1e6).toFixed(1);

console.log('--- 1. O(1) vs O(N): LINDEX vs a hash field ---');
await client.rPush(P + 'list', Array.from({ length: 100000 }, (_, i) => 'v' + i)); keys.push(P + 'list');
let t = process.hrtime.bigint();
await client.lIndex(P + 'list', 99999);
console.log(`  LINDEX at position 99999 (O(N)): ${ms(t)}ms`);
await client.hSet(P + 'hash', 'field99999', 'v99999'); keys.push(P + 'hash');
t = process.hrtime.bigint();
await client.hGet(P + 'hash', 'field99999');
console.log(`  HGET a field (O(1)):             ${ms(t)}ms`);
await client.del(keys.splice(0));

console.log('\n--- 2. Big-O cheat sheet, measured ---');
// Build a 100k-key DB
for (let i = 0; i < 100000; i++) await client.set(`${P}k:${i}`, i);
console.log('  100,000 keys in DB');

// GET is O(1)
t = process.hrtime.bigint();
await client.get(`${P}k:50000`);
console.log(`  GET one key (O(1))          : ${ms(t)}ms`);

// KEYS is O(N)
t = process.hrtime.bigint();
await client.keys(`${P}k:*`);
console.log(`  KEYS (O(N))                : ${ms(t)}ms  (blocks!)`);

// SCAN is O(N) total but non-blocking
t = process.hrtime.bigint();
let cur = '0', n = 0;
do {
  const r = await client.scan(cur, { MATCH: `${P}k:*`, COUNT: 1000 });
  cur = r.cursor; n += r.keys.length;
} while (cur !== '0');
console.log(`  SCAN all ${n} (O(N))         : ${ms(t)}ms  (never blocks)`);

// Cleanup
const scan = async (pat) => { const f = []; let c = '0'; do { const r = await client.scan(c, { MATCH: pat, COUNT: 1000 }); c = r.cursor; f.push(...r.keys); } while (c !== '0'); return f; };
await client.del(await scan(`${P}*`));

console.log('\n--- 3. Slow commands to avoid ---');
const slow = [
  ['KEYS *', 'O(N) over the whole DB'],
  ['SMEMBERS on a large set', 'O(N) + huge reply'],
  ['HGETALL on a large hash', 'O(N) + huge reply'],
  ['LRANGE 0 -1', 'O(N) + huge reply'],
  ['ZRANGE 0 -1', 'O(N) + huge reply'],
  ['SORT', 'O(N log N) + blocking'],
  ['SUNION/SINTER of huge sets', 'O(N×M)'],
  ['DEBUG OBJECT', 'slow, internal'],
  ['FLUSHALL/FLUSHDB', 'O(N), wipes everything'],
  ['MONITOR', 'cuts throughput ~50%'],
];
for (const [cmd, note] of slow) console.log(`  ${cmd.padEnd(32)} ${note}`);

console.log('\n--- 4. Pipeline vs sequential (measured) ---');
const N = 500;
t = process.hrtime.bigint();
for (let i = 0; i < N; i++) await client.set(`${P}p:${i}`, i);
const seqMs = Number(process.hrtime.bigint() - t) / 1e6;
t = process.hrtime.bigint();
const pending = [];
for (let i = 0; i < N; i++) pending.push(client.set(`${P}p:${i}`, i));
await Promise.all(pending);
const pipeMs = Number(process.hrtime.bigint() - t) / 1e6;
console.log(`  ${N} SETs sequential : ${seqMs.toFixed(0)}ms (${Math.round(N / seqMs * 1000).toLocaleString()} ops/sec)`);
console.log(`  ${N} SETs pipelined  : ${pipeMs.toFixed(0)}ms (${Math.round(N / pipeMs * 1000).toLocaleString()} ops/sec)`);
console.log(`  speedup: ${(seqMs / pipeMs).toFixed(1)}x`);

console.log('\n--- 5. Memory hygiene: per-key cost matters ---');
await client.set(P + 'small', 'hello'); keys.push(P + 'small');
await client.set(P + 'medium', 'x'.repeat(200)); keys.push(P + 'medium');
await client.set(P + 'num', 36); keys.push(P + 'num');
for (const k of keys) {
  console.log(`  ${k.padEnd(16)} ${String(await client.objectEncoding(k)).padEnd(8)} ${await client.memoryUsage(k)} bytes`);
}
console.log('  ^ small strings use embstr (inline), numbers use int, big strings use raw');

console.log('\n--- 6. Client-side caching (RESP3) ---');
const csc = createClient({ url: 'redis://127.0.0.1:6379', clientSideCache: { ttl: 0, maxEntries: 100, evictPolicy: 'LRU' } });
await csc.connect();
await csc.set(P + 'cached', 'value');
const r1 = await csc.withCommandOptions({ cache: true }).get(P + 'cached');
const r2 = await csc.withCommandOptions({ cache: true }).get(P + 'cached');
console.log('  first get  ->', r1, '(server round trip)');
console.log('  second get ->', r2, '(served from local cache)');
await csc.del(P + 'cached');
await csc.close();

// cleanup
await client.del(keys);
await client.del(await scan(`${P}*`));
console.log('\nDBSIZE after cleanup:', await client.dbSize());
await client.close();