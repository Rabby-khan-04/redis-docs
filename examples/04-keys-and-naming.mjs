/**
 * Chapter 04 - Keys and naming
 * Run:  node examples/04-keys-and-naming.mjs
 */
import { createClient } from 'redis';

const client = createClient({ url: 'redis://127.0.0.1:6379' });
await client.connect();

const P = 'ch04:';                      // one prefix for everything we create
const ours = [];

// ---------------------------------------------------------------------------
// 1. Key rules, verified
// ---------------------------------------------------------------------------
await client.set(P + 'name', 'Ada');
await client.set(P + 'age', '36');
ours.push(P + 'name', P + 'age');

console.log('Redis is CASE-SENSITIVE:');
console.log('  GET ch04:name  ->', await client.get('ch04:name'));
console.log('  GET ch04:Name  ->', await client.get('ch04:Name'), '(different key, does not exist)');

// keys may contain spaces, colons, and even be empty
await client.set(P + 'has space', 'ok'); ours.push(P + 'has space');
await client.set('', 'empty key works');  ours.push('');
console.log('key with a space ->', await client.get(P + 'has space'));
console.log('empty key ""     ->', await client.get(''));

// max key size, straight from config
const cfg = await client.configGet('proto-max-bulk-len');
const maxLen = cfg['proto-max-bulk-len'];
console.log('max key+value size:', (Number(maxLen) / 1024 / 1024) + ' MB');

// ---------------------------------------------------------------------------
// 2. One key holds exactly ONE type. Using the wrong command errors.
// ---------------------------------------------------------------------------
console.log('\nOne key = one type:');
console.log('  TYPE ch04:name        ->', await client.type(P + 'name'));
try {
  await client.lPush(P + 'name', ['x']);
} catch (e) {
  console.log('  LPUSH ch04:name x     ->', e.constructor.name + ': ' + e.message);
  console.log('     ^ the key still holds a string; the failed LPUSH changed nothing');
}

// ---------------------------------------------------------------------------
// 3. Internal encodings differ by value -- proof Redis specialises per usage.
// ---------------------------------------------------------------------------
await client.set(P + 'small-str', 'hello'); ours.push(P + 'small-str');
await client.set(P + 'big-str', 'x'.repeat(200)); ours.push(P + 'big-str');
await client.set(P + 'number', 36);           ours.push(P + 'number');
await client.hSet(P + 'hash', { a: '1', b: '2' }); ours.push(P + 'hash');
await client.rPush(P + 'list', ['a', 'b']);    ours.push(P + 'list');

console.log('\nInternal encoding (OBJECT ENCODING):');
for (const k of ['small-str', 'big-str', 'number', 'hash', 'list']) {
  const enc = await client.objectEncoding(P + k);
  const bytes = await client.memoryUsage(P + k);
  console.log(`  ${k.padEnd(11)} ${String(enc).padEnd(10)} ${bytes} bytes`);
}

// ---------------------------------------------------------------------------
// 4. KEYS vs SCAN: the blocking problem, measured.
// ---------------------------------------------------------------------------
console.log('\n--- Building a test keyspace ---');
for (let i = 0; i < 100_000; i++) await client.set(`bench:${i}`, i);
console.log('DBSIZE:', await client.dbSize());

const ms = (t) => (Number(process.hrtime.bigint() - t) / 1e6).toFixed(1);

// KEYS: fast, but it blocks the ENTIRE server for its whole duration.
let t = process.hrtime.bigint();
const found = await client.keys('bench:1*');
console.log(`KEYS('bench:1*')      -> ${found.length} keys in ${ms(t)}ms  (BLOCKS the server)`);

// SCAN: slower in total, but yields between chunks, so nobody else is blocked.
t = process.hrtime.bigint();
let n = 0, cursor = '0', rounds = 0;
do {
  const res = await client.scan(cursor, { MATCH: 'bench:1*', COUNT: 100 });
  cursor = res.cursor;                 // note: cursor is a STRING in node-redis 6
  n += res.keys.length;
  rounds++;
} while (cursor !== '0');
console.log(`SCAN ('bench:1*')     -> ${n} keys in ${ms(t)}ms over ${rounds} round trips (never blocks)`);

// one SCAN call returns only a slice
const one = await client.scan('0', { MATCH: 'bench:*', COUNT: 10 });
console.log(`one SCAN(COUNT:10)    -> cursor=${one.cursor}, ${one.keys.length} keys (DB has ${await client.dbSize()})`);

// scanIterator hides the loop. IMPORTANT: it yields BATCHES (arrays) per
// round trip, not one key at a time. That is why you can MGET the whole batch.
let batches = 0, viaIter = 0;
for await (const batch of client.scanIterator({ MATCH: 'bench:1*', COUNT: 1000 })) {
  batches++;
  viaIter += batch.length;
}
console.log(`scanIterator('bench:1*') -> ${viaIter} keys in ${batches} batches (same as the manual loop above)`);

// SCAN with TYPE skips keys you do not want to fetch
t = process.hrtime.bigint();
cursor = '0'; let onlyStr = 0;
do {
  const res = await client.scan(cursor, { MATCH: 'bench:*', TYPE: 'string', COUNT: 500 });
  cursor = res.cursor; onlyStr += res.keys.length;
} while (cursor !== '0');
console.log(`SCAN TYPE=string     -> ${onlyStr} keys in ${ms(t)}ms`);

// ---------------------------------------------------------------------------
// 5. PROOF: measure an unrelated client's latency while each one runs.
// ---------------------------------------------------------------------------
console.log('\n--- Latency of an UNRELATED GET on another connection ---');
const probe = client.duplicate();
await probe.connect();
await client.set(P + 'ping', 'pong'); ours.push(P + 'ping');

async function measure(label, work) {
  const s = [];
  const timer = setInterval(async () => {
    const t0 = process.hrtime.bigint();
    await probe.get(P + 'ping');
    s.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }, 5);
  await work();
  await new Promise(r => setTimeout(r, 2000));
  clearInterval(timer);
  s.sort((a, b) => a - b);
  const p = (q) => s[Math.floor(s.length * q)].toFixed(2);
  console.log(`  ${label.padEnd(16)} p50=${p(0.5).padStart(5)}ms  p99=${p(0.99).padStart(6)}ms  max=${s[s.length - 1].toFixed(2).padStart(6)}ms`);
}

await measure('idle server', async () => {});
await measure('during KEYS', async () => { await client.keys('bench:*'); });
await measure('during SCAN', async () => {
  let cur = '0';
  do {
    const r = await client.scan(cur, { MATCH: 'bench:*', COUNT: 100 });
    cur = r.cursor;
    await new Promise(r2 => setTimeout(r2, 0));   // yield, like real code
  } while (cur !== '0');
});

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------
console.log('\ncleaning up...');
let batch = [];
for (let i = 0; i < 100_000; i += 500) {
  batch = Array.from({ length: 500 }, (_, j) => `bench:${i + j}`);
  await client.del(batch);
}
await client.del(ours);
console.log('DBSIZE after cleanup:', await client.dbSize());

await probe.close();
await client.close();