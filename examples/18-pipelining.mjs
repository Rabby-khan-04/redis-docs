/**
 * Chapter 18 - Pipelining
 * Run:  node examples/18-pipelining.mjs
 */
import { createClient } from 'redis';

const client = createClient({ url: 'redis://127.0.0.1:6379' });
await client.connect();

const P = 'ch18:';
const N = 2000;

// ---------------------------------------------------------------------------
// 1. The problem: one network round trip per await
// ---------------------------------------------------------------------------
console.log('--- sequential: one round trip each ---');
let t = process.hrtime.bigint();
for (let i = 0; i < 200; i++) await client.set(`${P}k:${i}`, i);
let ms = Number(process.hrtime.bigint() - t) / 1e6;
const seqOps = Math.round(200 / ms * 1000);
console.log(`200 sequential SETs:  ${ms.toFixed(0)}ms (${seqOps.toLocaleString()} ops/sec)`);

// ---------------------------------------------------------------------------
// 2. ⭐ Auto-pipelining: fire them all, await once
// ---------------------------------------------------------------------------
console.log('\n--- auto-pipelined: no await inside the loop ---');
t = process.hrtime.bigint();
const pending = [];
for (let i = 0; i < N; i++) pending.push(client.set(`${P}k:${i}`, i));
await Promise.all(pending);
ms = Number(process.hrtime.bigint() - t) / 1e6;
const pipedOps = Math.round(N / ms * 1000);
console.log(`${N} auto-pipelined SETs: ${ms.toFixed(0)}ms (${pipedOps.toLocaleString()} ops/sec)`);
console.log(`  speedup vs sequential: ${(pipedOps / seqOps).toFixed(1)}x`);

// ---------------------------------------------------------------------------
// 3. Explicit pipeline with execAsPipeline
// ---------------------------------------------------------------------------
console.log('\n--- explicit pipeline: multi().execAsPipeline() ---');
t = process.hrtime.bigint();
const replies = await client.multi()
  .set(`${P}p:1`, 'a')
  .set(`${P}p:2`, 'b')
  .incr(`${P}p:counter`)
  .get(`${P}p:1`)
  .execAsPipeline();
ms = Number(process.hrtime.bigint() - t) / 1e6;
console.log(`${ms.toFixed(1)}ms, replies ->`, replies);
console.log('  ^ NOT atomic (no MULTI/EXEC), but sent as ONE batch');

// ---------------------------------------------------------------------------
// 4. ⭐ Transaction vs pipeline: same batching, different guarantees
// ---------------------------------------------------------------------------
console.log('\n--- transaction vs pipeline ---');
const other = client.duplicate();
await other.connect();

const atomic = await client.multi().set(`${P}t:a`, '1').get(`${P}t:b`).exec();
const piped = await client.multi().set(`${P}p:a`, '1').get(`${P}p:b`).execAsPipeline();
console.log('multi().exec()            ->', atomic, '(atomic)');
console.log('multi().execAsPipeline()  ->', piped, '(batched, NOT atomic)');

// ---------------------------------------------------------------------------
// 5. Batching a big job into chunks
// ---------------------------------------------------------------------------
console.log('\n--- batching a big job ---');
await client.del(`${P}batch`);
t = process.hrtime.bigint();
for (let start = 0; start < 10000; start += 1000) {
  const batch = client.multi();
  for (let i = start; i < start + 1000; i++) batch.set(`${P}batch:${i}`, i);
  await batch.execAsPipeline();          // 10 round trips total instead of 10,000
}
ms = Number(process.hrtime.bigint() - t) / 1e6;
console.log(`10,000 SETs in chunks of 1000: ${ms.toFixed(0)}ms (10 round trips)`);
console.log('  total keys now:', await client.dbSize());

// ---------------------------------------------------------------------------
// 6. ⚠️ Pipeline error handling: it THROWS a plain SimpleError
// ---------------------------------------------------------------------------
console.log('\n--- ⚠️ pipeline error handling ---');
await client.set(`${P}str`, 'plain');
try {
  await client.multi()
    .set(`${P}fine`, 'ok')
    .lPush(`${P}str`, ['x'])     // ✗ WRONGTYPE
    .set(`${P}fine2`, 'ok')
    .execAsPipeline();
  console.log('no error thrown');
} catch (e) {
  console.log('execAsPipeline THREW ->', e.constructor.name + ':', e.message);
  console.log('  e.replies      ->', e.replies, '(undefined -- unlike multi().exec())');
  console.log('  e.errorIndexes ->', e.errorIndexes);
}
console.log('  ^ NOTE THE DIFFERENCE:');
console.log('    multi().exec()   -> throws MultiErrorReply WITH .replies/.errorIndexes');
console.log('    execAsPipeline() -> throws a bare SimpleError, you LOSE the other replies');
console.log('  fine  =', await client.get(`${P}fine`),  ' (it still ran!)');
console.log('  fine2 =', await client.get(`${P}fine2`), ' (it still ran!)');
console.log('  ^ every command in the pipeline still executes; only the reporting differs.')

// ---------------------------------------------------------------------------
// 7. Reading a big value: pipeline the reads too
// ---------------------------------------------------------------------------
console.log('\n--- MGET is one round trip, but so is a pipeline of GETs ---');
await client.set(`${P}v:1`, 'a'); await client.set(`${P}v:2`, 'b'); await client.set(`${P}v:3`, 'c');
t = process.hrtime.bigint();
const m = await client.mGet([`${P}v:1`, `${P}v:2`, `${P}v:3`]);
ms = Number(process.hrtime.bigint() - t) / 1e6;
console.log(`MGET 3 keys: ${ms.toFixed(2)}ms ->`, m);

const pipeReads = await client.multi()
  .get(`${P}v:1`).get(`${P}v:2`).get(`${P}v:3`)
  .execAsPipeline();
console.log('pipelined 3 GETs ->', pipeReads, '(same round trips, more control)');

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------
await client.del([`${P}batch`, `${P}p:a`, `${P}p:b`, `${P}t:a`, `${P}t:b`]);
let cursor = '0';
do {
  const r = await client.scan(cursor, { MATCH: `${P}*`, COUNT: 1000 });
  cursor = r.cursor;
  if (r.keys.length) await client.del(r.keys);
} while (cursor !== '0');
console.log('\nDBSIZE after cleanup:', await client.dbSize());
await other.close();
await client.close();