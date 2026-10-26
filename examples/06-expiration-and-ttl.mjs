/**
 * Chapter 06 - Expiration and TTL
 * Run:  node examples/06-expiration-and-ttl.mjs
 */
import { createClient } from 'redis';

const client = createClient({ url: 'redis://127.0.0.1:6379' });
await client.connect();

const P = 'ch06:';
const keys = [];

// ---------------------------------------------------------------------------
// 1. The three values of TTL -- this is the part everyone gets wrong.
// ---------------------------------------------------------------------------
await client.set(P + 'forever', 'v'); keys.push(P + 'forever');
await client.set(P + 'expiring', 'v', { EX: 100 }); keys.push(P + 'expiring');

console.log('--- what TTL can return ---');
console.log('key that exists, no expiry ->', await client.ttl(P + 'forever'), '(-1 = exists forever)');
console.log('key that exists, with TTL  ->', await client.ttl(P + 'expiring'));
console.log('key that does not exist    ->', await client.ttl(P + 'ghost'), '(-2 = no such key)');
console.log('');
console.log('⚠️  -1 and -2 mean completely different things, and -2 is NOT "0 seconds left".');

// ---------------------------------------------------------------------------
// 2. Setting, removing and inspecting expiry
// ---------------------------------------------------------------------------
console.log('\n--- EXPIRE / PERSIST / PEXPIRE ---');
await client.set(P + 'x', 'v'); keys.push(P + 'x');
console.log('EXPIRE x 100   ->', await client.expire(P + 'x', 100));
console.log('TTL x          ->', await client.ttl(P + 'x'));
console.log('PTTL x         ->', await client.pTTL(P + 'x'), '(milliseconds)');
console.log('expireTime x   ->', await client.expireTime(P + 'x'), '(absolute unix seconds)');
console.log('PERSIST x      ->', await client.persist(P + 'x'));
console.log('TTL x          ->', await client.ttl(P + 'x'), '(-1 again: expiry removed)');
await client.del(keys.splice(0));

// EXPIRE on a missing key
console.log('EXPIRE ghost 100 ->', await client.expire(P + 'ghost', 100), '(0 = no key to expire)');

// ---------------------------------------------------------------------------
// 3. EXPIRE 0 deletes the key IMMEDIATELY
// ---------------------------------------------------------------------------
await client.set(P + 'doomed', 'v'); keys.push(P + 'doomed');
console.log('\n--- EXPIRE 0 ---');
console.log('EXPIRE doomed 0 ->', await client.expire(P + 'doomed', 0));
console.log('EXISTS doomed   ->', await client.exists(P + 'doomed'), '(gone already)');

// ---------------------------------------------------------------------------
// 4. Watch a key actually disappear
// ---------------------------------------------------------------------------
console.log('\n--- watching expiry happen ---');
await client.set(P + 'short', 'bye', { PX: 1200 }); keys.push(P + 'short');
console.log('PTTL right after set ->', await client.pTTL(P + 'short'), 'ms');
await new Promise(r => setTimeout(r, 600));
console.log('PTTL after 600ms     ->', await client.pTTL(P + 'short'), 'ms');
console.log('GET mid-life         ->', await client.get(P + 'short'));
await new Promise(r => setTimeout(r, 900));
console.log('GET after 1.5s       ->', await client.get(P + 'short'), '(expired)');
console.log('TTL on expired key   ->', await client.ttl(P + 'short'), '(-2)');

// ---------------------------------------------------------------------------
// 5. How does Redis actually delete expired keys? Two ways, lazily.
// ---------------------------------------------------------------------------
console.log('\n--- lazy vs active expiration ---');
// Create 20k short-lived keys, then measure GET latency while they die.
for (let i = 0; i < 20_000; i++) {
  await client.set(`${P}lazy:${i}`, 'x', { PX: 1500 });
}
console.log('created 20,000 keys with 1.5s TTL');
console.log('DBSIZE now:', await client.dbSize());
await new Promise(r => setTimeout(r, 2000));
console.log('DBSIZE after they expire:', await client.dbSize());
console.log('   (expiry is lazy: a key is deleted when looked up, or by the active cycle)');

async function collect(pattern) {
  const found = [];
  let cursor = '0';
  do {
    const r = await client.scan(cursor, { MATCH: pattern, COUNT: 1000 });
    cursor = r.cursor;
    found.push(...r.keys);
  } while (cursor !== '0');
  return found;
}

// DEL rejects zero arguments, so only call it when we found something.
async function delMatching(pattern) {
  const found = await collect(pattern);
  if (found.length === 0) return 0;
  for (let i = 0; i < found.length; i += 500) {
    await client.del(found.slice(i, i + 500));
  }
  return found.length;
}

await delMatching(`${P}lazy:*`);

// ---------------------------------------------------------------------------
// 6. Renaming and copying carry the TTL
// ---------------------------------------------------------------------------
console.log('\n--- RENAME / COPY and TTL ---');
await client.set(P + 'src', 'v', { EX: 100 }); keys.push(P + 'src');
console.log('TTL src                ->', await client.ttl(P + 'src'));
await client.rename(P + 'src', P + 'dst'); keys.push(P + 'dst');
console.log('TTL after RENAME dst   ->', await client.ttl(P + 'dst'), '(TTL moved with the key)');
console.log('COPY (ttl -1 = not copied) ->', await client.copy(P + 'dst', P + 'copy'));
console.log('TTL copy               ->', await client.ttl(P + 'copy'));
keys.push(P + 'copy');
await client.del(keys.splice(0));

// ---------------------------------------------------------------------------
// 7. The classic leak: SET without a TTL
// ---------------------------------------------------------------------------
console.log('\n--- the TTL leak ---');
const before = (await client.info('memory')).match(/used_memory:(\d+)/)[1];
for (let i = 0; i < 10_000; i++) await client.set(`${P}leak:${i}`, 'x');
const after = (await client.info('memory')).match(/used_memory:(\d+)/)[1];
console.log(`10,000 keys with NO TTL -> memory ${before} -> ${after} bytes`);
console.log('they will stay forever. This is how Redis servers die.');

await delMatching(`${P}leak:*`);
console.log('DBSIZE after cleanup:', await client.dbSize());

// ---------------------------------------------------------------------------
// 8. Expiry is NOT eviction. They are different mechanisms.
// ---------------------------------------------------------------------------
const pol = await client.configGet('maxmemory-policy');
console.log('\nmaxmemory-policy is:', pol['maxmemory-policy']);
console.log('  expiry  = this key\'s own timer fires  (chapters 06, 07)')
console.log('  eviction = memory is full, so Redis THROWS DATA AWAY (chapter 22)');

await delMatching(`${P}*`);
console.log('DBSIZE after final cleanup:', await client.dbSize());

await client.close();