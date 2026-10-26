/**
 * Chapter 05 - Strings
 * Run:  node examples/05-strings.mjs
 */
import { createClient } from 'redis';

const client = createClient({ url: 'redis://127.0.0.1:6379' });
await client.connect();

const P = 'ch05:';
const keys = [];

// ---------------------------------------------------------------------------
// 1. The basics
// ---------------------------------------------------------------------------
await client.set(P + 'name', 'Ada'); keys.push(P + 'name');
await client.set(P + 'count', 42);  keys.push(P + 'count');

console.log('GET name  ->', await client.get(P + 'name'));
console.log('GET count ->', await client.get(P + 'count'), '(always a STRING, even for a number)');
console.log('typeof    ->', typeof (await client.get(P + 'count')));
await client.del(keys.splice(0));

// ---------------------------------------------------------------------------
// 2. SET options: EX, NX, XX, KEEPTTL, GET
// ---------------------------------------------------------------------------
console.log('\n--- SET options ---');

// NX = only if NOT exists  (this is how locks and "insert if absent" work)
console.log('SET nx first time ->', await client.set(P + 'nx', 'a', { NX: true }));
console.log('SET nx second     ->', await client.set(P + 'nx', 'b', { NX: true }), '(null = refused)');
console.log('  value is still  ->', await client.get(P + 'nx'));

// XX = only if eXists
console.log('SET xx on missing ->', await client.set(P + 'xx', 'a', { XX: true }), '(null = refused)');

// EX = expire after N seconds
await client.set(P + 'ex', 'v', { EX: 100 }); keys.push(P + 'ex', P + 'nx');
console.log('SET EX 100  TTL   ->', await client.ttl(P + 'ex'));

// KEEPTTL = keep the existing expiry when overwriting
await client.set(P + 'ex', 'v2', { KEEPTTL: true });
console.log('after KEEPTTL TTL ->', await client.ttl(P + 'ex'), '(survived)');
await client.set(P + 'ex', 'v3');                       // plain SET drops the TTL
console.log('after plain SET   ->', await client.ttl(P + 'ex'), '(-1 = no expiry!)');
await client.del(keys.splice(0));

// GET = return the OLD value in the same atomic call
await client.set(P + 'get', 'old'); keys.push(P + 'get');
console.log('SET ... GET       ->', await client.set(P + 'get', 'new', { GET: true }), '(returned old value)');
console.log('value now         ->', await client.get(P + 'get'));
await client.del(keys.splice(0));

// ---------------------------------------------------------------------------
// 3. INCR: the reason Redis is more than a cache
// ---------------------------------------------------------------------------
console.log('\n--- INCR family ---');
await client.set(P + 'n', 10); keys.push(P + 'n');
console.log('INCR      ->', await client.incr(P + 'n'));
console.log('INCRBY 5  ->', await client.incrBy(P + 'n', 5));
console.log('DECR      ->', await client.decr(P + 'n'));

await client.set(P + 'f', 10.5); keys.push(P + 'f');
console.log('INCRBYFLOAT 0.1 ->', await client.incrByFloat(P + 'f', 0.1), '(floats work too)');

// errors, not silent corruption
await client.set(P + 'word', 'abc'); keys.push(P + 'word');
try {
  await client.incr(P + 'word');
} catch (e) {
  console.log('INCR on "abc"     ->', e.message);
}

await client.set(P + 'big', 9223372036854775807n.toString()); keys.push(P + 'big');
try {
  await client.incr(P + 'big');
} catch (e) {
  console.log('INCR at int64 max ->', e.message);
}
await client.del(keys.splice(0));

// Prove INCR is atomic: 10,000 concurrent increments, no lost updates.
await client.set(P + 'race', 0);
const results = await Promise.all(Array.from({ length: 10_000 }, () => client.incr(P + 'race')));
console.log(`10,000 concurrent INCRs -> final value ${await client.get(P + 'race')} (expect exactly 10000)`);
console.log(`  distinct replies: ${new Set(results).size}, max: ${Math.max(...results)}`);
keys.push(P + 'race');
await client.del(keys.splice(0));

// ---------------------------------------------------------------------------
// 4. Working with the bytes
// ---------------------------------------------------------------------------
console.log('\n--- string operations ---');
await client.set(P + 'str', 'Hello World'); keys.push(P + 'str');
console.log('STRLEN    ->', await client.strLen(P + 'str'));
console.log('APPEND !  ->', await client.append(P + 'str', '!'));
console.log('GETRANGE 0 4 ->', await client.getRange(P + 'str', 0, 4));
await client.setRange(P + 'str', 6, 'Redis');
console.log('after SETRANGE ->', await client.get(P + 'str'));
await client.del(keys.splice(0));

// Binary safe: newlines, nulls, JSON are all just bytes.
const doc = { id: 7, tags: ['a', 'b'] };
await client.set(P + 'json', JSON.stringify(doc)); keys.push(P + 'json');
console.log('\nstored JSON      ->', await client.get(P + 'json'));
console.log('parsed back      ->', JSON.parse(await client.get(P + 'json')));
await client.del(keys.splice(0));

// ---------------------------------------------------------------------------
// 5. One round trip for many keys
// ---------------------------------------------------------------------------
console.log('\n--- MSET / MGET ---');
await client.mSet({ [P + 'm1']: 'a', [P + 'm2']: 'b', [P + 'm3']: 'c' });
keys.push(P + 'm1', P + 'm2', P + 'm3');
console.log('MGET m1 m2 nope m3 ->', await client.mGet([P + 'm1', P + 'm2', P + 'nope', P + 'm3']));
console.log('  (missing key came back as null, not an error)');
await client.del(keys.splice(0));

// ---------------------------------------------------------------------------
// 6. GETDEL / GETEX -- read and change in one atomic step
// ---------------------------------------------------------------------------
await client.set(P + 'queue:item', 'payload'); keys.push(P + 'queue:item');
console.log('\nGETDEL ->', await client.getDel(P + 'queue:item'));
console.log('GETDEL again ->', await client.getDel(P + 'queue:item'), '(key was consumed)');
await client.set(P + 'cache:x', 'data');
console.log('GETEX EX 50 ->', await client.getEx(P + 'cache:x', { EX: 50 }));
console.log('  TTL now  ->', await client.ttl(P + 'cache:x'));
keys.push(P + 'cache:x');
await client.del(keys.splice(0));

// ---------------------------------------------------------------------------
// 7. How much memory does a string cost?
// ---------------------------------------------------------------------------
await client.set(P + 'small', 'hello');    keys.push(P + 'small');
await client.set(P + 'medium', 'x'.repeat(200)); keys.push(P + 'medium');
await client.set(P + 'num', 36);          keys.push(P + 'num');

console.log('\n--- memory + encoding ---');
for (const k of ['small', 'medium', 'num']) {
  console.log(`  ${k.padEnd(7)} ${String(await client.objectEncoding(P + k)).padEnd(7)} ${await client.memoryUsage(P + k)} bytes`);
}
console.log('  note: the number 36 costs FEWER bytes than the string "36"');

await client.del(keys);
await client.close();