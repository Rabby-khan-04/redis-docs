/**
 * Chapter 08 - Lists
 * Run:  node examples/08-lists.mjs
 */
import { createClient } from 'redis';

const client = createClient({ url: 'redis://127.0.0.1:6379' });
await client.connect();

const P = 'ch08:';
const keys = [];

// ---------------------------------------------------------------------------
// 1. Push, pop, read
// ---------------------------------------------------------------------------
// ⚠️ In node-redis 6, MULTIPLE values must be passed as an ARRAY.
//    rPush(key, 'a','b','c') silently keeps only 'a'.
await client.rPush(P + 'tasks', ['write', 'review', 'ship']);
keys.push(P + 'tasks');

console.log('--- basics ---');
console.log('LLEN       ->', await client.lLen(P + 'tasks'));
console.log('LRANGE 0 -1->', await client.lRange(P + 'tasks', 0, -1));
console.log('LINDEX 0   ->', await client.lIndex(P + 'tasks', 0));
console.log('LPOP       ->', await client.lPop(P + 'tasks'), '(from the left)');
console.log('RPOP       ->', await client.rPop(P + 'tasks'), '(from the right)');
console.log('remaining  ->', await client.lRange(P + 'tasks', 0, -1));

await client.del(keys.splice(0));

// ---------------------------------------------------------------------------
// 2. The varargs trap -- demonstrate the silent data loss
// ---------------------------------------------------------------------------
await client.rPush(P + 'bad', 'a', 'b', 'c');
console.log('\n--- ⚠️ the varargs trap ---');
console.log("rPush(key,'a','b','c') ->", await client.lRange(P + 'bad', 0, -1),
            '  ← "b" and "c" were SILENTLY DROPPED');
console.log("rPush(key,['a','b','c']) ->");
await client.del(P + 'bad');
await client.rPush(P + 'good', ['a', 'b', 'c']);
console.log('  ->', await client.lRange(P + 'good', 0, -1), '  ✓ all three stored');
keys.push(P + 'bad', P + 'good');
await client.del(keys.splice(0));

// ---------------------------------------------------------------------------
// 3. Insert, delete, index
// ---------------------------------------------------------------------------
await client.rPush(P + 'l', ['a', 'b', 'c']); keys.push(P + 'l');
console.log('\n--- editing ---');
console.log('LINSERT BEFORE b ->', await client.lInsert(P + 'l', 'BEFORE', 'b', 'z'));
console.log('list             ->', await client.lRange(P + 'l', 0, -1));
console.log('LSET 0 X         ->', await client.lSet(P + 'l', 0, 'X'));
console.log('LPOS c           ->', await client.lPos(P + 'l', 'c'), '(0-based index)');
console.log('LPOS nope        ->', await client.lPos(P + 'l', 'nope'), '(null = not found)');
console.log('LSET bad index   ->', await client.lSet(P + 'l', 99, 'x').catch(e => e.message));

// ---------------------------------------------------------------------------
// 4. Blocking pops -- the classic queue
// ---------------------------------------------------------------------------
console.log('\n--- blocking pop (real queue behaviour) ---');
const worker = client.duplicate();
await worker.connect();

// This will BLOCK until a producer pushes something.
// NOTE: the method is blPop (lowercase 'l'), not bLPop.
const t0 = process.hrtime.bigint();
const blocked = worker.blPop(P + 'work', 3);   // BLPOP with 3s timeout
await new Promise(r => setTimeout(r, 300));
await client.rPush(P + 'work', ['job-1']);
const got = await blocked;
const waited = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(`BLPOP returned ${JSON.stringify(got)} after ${waited.toFixed(0)}ms (it really waited)`);
keys.push(P + 'work');

// Timeout: nothing pushed -> nil after the timeout
const t1 = process.hrtime.bigint();
const timedOut = await worker.blPop(P + 'work', 1);
console.log(`BLPOP timeout -> ${JSON.stringify(timedOut)} after ${(Number(process.hrtime.bigint() - t1) / 1e6).toFixed(0)}ms`);

// ---------------------------------------------------------------------------
// 5. LMOVE -- moving between lists atomically (job queues)
// ---------------------------------------------------------------------------
console.log('\n--- LMOVE ---');
await client.rPush(P + 'queue:pending', ['job-a', 'job-b']); keys.push(P + 'queue:pending');
const moved = await client.lMove(P + 'queue:pending', P + 'queue:active', 'LEFT', 'RIGHT');
console.log(`LMOVE pending->active -> ${moved}`);
console.log('pending ->', await client.lRange(P + 'queue:pending', 0, -1));
console.log('active  ->', await client.lRange(P + 'queue:active', 0, -1));
keys.push(P + 'queue:active');

// ---------------------------------------------------------------------------
// 6. LMPOP -- pop from several lists at once
// ---------------------------------------------------------------------------
await client.rPush(P + 'm1', ['1', '2', '3']);
await client.rPush(P + 'm2', ['a', 'b']); keys.push(P + 'm1', P + 'm2');
console.log('\n--- LMPOP ---');
console.log('lmPop([m1,m2], LEFT, {COUNT:1}) ->', await client.lmPop([P + 'm1', P + 'm2'], 'LEFT', { COUNT: 1 }));

// ---------------------------------------------------------------------------
// 7. LTRIM -- keep the list small
// ---------------------------------------------------------------------------
await client.del(P + 'trim');
for (let i = 0; i < 1000; i++) await client.rPush(P + 'trim', 'item' + i);
keys.push(P + 'trim');
console.log('\n--- LTRIM ---');
console.log('LLEN before ->', await client.lLen(P + 'trim'));
console.log('LTRIM 0 99  ->', await client.lTrim(P + 'trim', 0, 99));
console.log('LLEN after  ->', await client.lLen(P + 'trim'));

// ---------------------------------------------------------------------------
// 8. Encoding: in Redis 8 the list listpack limit is UNLIMITED by default
// ---------------------------------------------------------------------------
console.log('\n--- encoding ---');
const cfgList = await client.configGet('list-max-listpack-size');
const cfgDepth = await client.configGet('list-compress-depth');
console.log('list-max-listpack-size :', cfgList['list-max-listpack-size'], '(-2 = unlimited)');
console.log('list-compress-depth    :', cfgDepth['list-compress-depth'], '(0 = compression off)');

await client.del(P + 'small');
await client.rPush(P + 'small', ['a', 'b', 'c']);
console.log('3 items  ->', await client.objectEncoding(P + 'small'),
            `(${await client.memoryUsage(P + 'small')} bytes)`);
for (let i = 0; i < 300; i++) await client.rPush(P + 'small', 'x' + i);
console.log('303 items->', await client.objectEncoding(P + 'small'),
            `(${await client.memoryUsage(P + 'small')} bytes)`);
console.log('  ^ still listpack. Older docs say 128 and a "quicklist" switch -- in Redis 8');
console.log('    the default limit is -2 (unlimited), so there is no switch at all.');
keys.push(P + 'small');

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------
await client.del(keys);
await worker.close();
console.log('\nDBSIZE after cleanup:', await client.dbSize());
await client.close();