/**
 * Chapter 29 - Real-world patterns
 * Run:  node examples/29-real-world-patterns.mjs
 */
import { createClient } from 'redis';

const client = createClient({ url: 'redis://127.0.0.1:6379' });
await client.connect();

const P = 'ch29:';
const keys = [];

console.log('--- 1. Caching (cache-aside) ---');
await client.set(P + 'db:user:42', JSON.stringify({ name: 'Ada', age: 36 }));
let miss = 0, hit = 0;
async function getUser(id) {
  const cached = await client.get(P + `cache:user:${id}`);
  if (cached) { hit++; return JSON.parse(cached); }
  miss++;
  const user = JSON.parse(await client.get(P + `db:user:${id}`));
  await client.set(P + `cache:user:${id}`, JSON.stringify(user), { EX: 300 });
  return user;
}
console.log('first call  ->', await getUser(42), '(MISS, fetched from DB, cached)');
console.log('second call ->', await getUser(42), '(HIT, returned from cache)');
console.log('misses:', miss, 'hits:', hit);
await client.del(P + 'cache:user:42');
console.log('after invalidation ->', await getUser(42), '(MISS again)');
keys.push(P + 'db:user:42', P + 'cache:user:42');

console.log('\n--- 2. Session storage ---');
const sid = 'sid1';
await client.hSet(P + `session:${sid}`, { userId: '42', role: 'admin', ip: '10.0.0.1' });
await client.expire(P + `session:${sid}`, 3600);
keys.push(P + `session:${sid}`);
console.log('HSET session:sid1 userId 42 role admin ip 10.0.0.1');
console.log('HGETALL ->', await client.hGetAll(P + `session:${sid}`));
console.log('TTL ->', await client.ttl(P + `session:${sid}`));

console.log('\n--- 3. Rate limiting (fixed window) ---');
const RATE = `local c=redis.call('INCR',KEYS[1]) if c==1 then redis.call('EXPIRE',KEYS[1],tonumber(ARGV[1])) end return c`;
await client.del(P + 'rate:ip1');
const counts = [];
for (let i = 0; i < 7; i++) counts.push(await client.eval(RATE, { keys: [P + 'rate:ip1'], arguments: ['10'] }));
keys.push(P + 'rate:ip1');
console.log('7 calls: [', counts.join(', '), ']');
console.log('allowed (<=3):', counts.filter(c => c <= 3).length, ' refused:', counts.filter(c => c > 3).length);
console.log('TTL ->', await client.ttl(P + 'rate:ip1'), '(the window is the TTL)');

console.log('\n--- 4. Shopping cart ---');
await client.hSet(P + 'cart:u1', { item1: '2', item2: '1' });
await client.hIncrBy(P + 'cart:u1', 'item1', 1);
keys.push(P + 'cart:u1');
console.log('HSET cart:u1 item1 2 item2 1');
console.log('HINCRBY item1 1 ->', await client.hGet(P + 'cart:u1', 'item1'));
console.log('HGETALL ->', await client.hGetAll(P + 'cart:u1'));

console.log('\n--- 5. Leaderboard ---');
await client.zAdd(P + 'lb', [
  { score: 100, value: 'alice' }, { score: 50, value: 'carol' }, { score: 100, value: 'bob' },
]);
await client.zIncrBy(P + 'lb', 50, 'alice');
keys.push(P + 'lb');
console.log('top 3 ->', await client.zRangeWithScores(P + 'lb', 0, 2, { REV: true }));
console.log('alice rank (0-based, best first) ->', await client.zRevRank(P + 'lb', 'alice'));
console.log('ZCOUNT 50..200 ->', await client.zCount(P + 'lb', 50, 200));

console.log('\n--- 6. Job queue (list) ---');
await client.rPush(P + 'jobs', ['job-1', 'job-2', 'job-3']);
const w1 = client.duplicate(); await w1.connect();
const w2 = client.duplicate(); await w2.connect();
console.log('enqueue 3 jobs');
console.log('BLPOP ->', await w1.blPop(P + 'jobs', 1));
console.log('BLPOP ->', await w2.blPop(P + 'jobs', 1));
console.log('remaining ->', await client.lRange(P + 'jobs', 0, -1));
keys.push(P + 'jobs');
await w1.close(); await w2.close();

console.log('\n--- 7. Distributed lock ---');
const token = 'tok-' + Math.random().toString(36).slice(2);
const lockKey = P + 'lock:invoice:42';
const RELEASE = `if redis.call("GET",KEYS[1])==ARGV[1] then return redis.call("DEL",KEYS[1]) else return 0 end`;
console.log('acquire lock ->', await client.set(lockKey, token, { NX: true, EX: 30 }));
console.log('second acquire ->', await client.set(lockKey, 'other', { NX: true, EX: 30 }));
console.log('release with correct token ->', await client.eval(RELEASE, { keys: [lockKey], arguments: [token] }));
console.log('release with WRONG token ->', await client.eval(RELEASE, { keys: [lockKey], arguments: ['wrong'] }));
keys.push(lockKey);

console.log('\n--- 8. Atomic counter ---');
await client.set(P + 'views', '0');
const results = await Promise.all(Array.from({ length: 10000 }, () => client.incr(P + 'views')));
keys.push(P + 'views');
console.log('10,000 concurrent INCRs ->', await client.get(P + 'views'), '(exact)');

// cleanup
const scan = async (pat) => { const f = []; let cur = '0'; do { const r = await client.scan(cur, { MATCH: pat, COUNT: 1000 }); cur = r.cursor; f.push(...r.keys); } while (cur !== '0'); return f; };
await client.del(await scan(`${P}*`));
console.log('\nDBSIZE after cleanup:', await client.dbSize());
await client.close();