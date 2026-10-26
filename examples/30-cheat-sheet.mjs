/**
 * Chapter 30 - Cheat sheet smoke test
 * Run:  node examples/30-cheat-sheet.mjs
 *
 * Runs one representative command from every major family against your live server
 * and prints its Big-O, so you can confirm the whole surface area works.
 */
import { createClient } from 'redis';

const client = createClient({ url: 'redis://127.0.0.1:6379' });
await client.connect();

const P = 'ch30:';
const keys = [];

async function check(name, bigO, fn) {
  try {
    const r = await fn();
    console.log(`  ${name.padEnd(26)} ${bigO.padEnd(12)} OK  (${typeof r === 'object' ? JSON.stringify(r).slice(0, 40) : r})`);
  } catch (e) {
    console.log(`  ${name.padEnd(26)} ${bigO.padEnd(12)} FAIL  ${e.message.slice(0, 60)}`);
  }
}

console.log('--- strings ---');
await client.set(P + 's', '42'); keys.push(P + 's');
await check('SET/GET', 'O(1)', async () => await client.get(P + 's'));
await check('INCR', 'O(1)', async () => await client.incr(P + 's'));
await check('MGET', 'O(N)', async () => await client.mGet([P + 's']));

console.log('--- keys ---');
await check('TYPE', 'O(1)', async () => await client.type(P + 's'));
await check('EXISTS', 'O(1)', async () => await client.exists(P + 's'));
await check('TTL', 'O(1)', async () => await client.ttl(P + 's'));
await check('SCAN', 'O(1)/call', async () => { let c = '0', n = 0; do { const r = await client.scan(c, { MATCH: P + '*', COUNT: 10 }); c = r.cursor; n += r.keys.length; } while (c !== '0'); return n; });

console.log('--- hashes ---');
await client.hSet(P + 'h', { a: '1', b: '2' }); keys.push(P + 'h');
await check('HGET', 'O(1)', async () => await client.hGet(P + 'h', 'a'));
await check('HGETALL', 'O(N)', async () => await client.hGetAll(P + 'h'));
await check('HINCRBY', 'O(1)', async () => await client.hIncrBy(P + 'h', 'a', 1));

console.log('--- lists ---');
await client.rPush(P + 'l', ['a', 'b', 'c']); keys.push(P + 'l');
await check('LLEN', 'O(1)', async () => await client.lLen(P + 'l'));
await check('LRANGE', 'O(S+N)', async () => await client.lRange(P + 'l', 0, -1));
await check('LPOP', 'O(1)', async () => await client.lPop(P + 'l'));

console.log('--- sets ---');
await client.sAdd(P + 'set', ['a', 'b', 'c']); keys.push(P + 'set');
await check('SCARD', 'O(1)', async () => await client.sCard(P + 'set'));
await check('SISMEMBER', 'O(1)', async () => await client.sIsMember(P + 'set', 'a'));
await check('SINTER', 'O(N×M)', async () => await client.sInter([P + 'set', P + 'set']));

console.log('--- sorted sets ---');
await client.zAdd(P + 'z', [{ score: 1, value: 'a' }, { score: 2, value: 'b' }]); keys.push(P + 'z');
await check('ZCARD', 'O(1)', async () => await client.zCard(P + 'z'));
await check('ZSCORE', 'O(1)', async () => await client.zScore(P + 'z', 'a'));
await check('ZRANGE', 'O(logN+M)', async () => await client.zRangeWithScores(P + 'z', 0, -1));
await check('ZINCRBY', 'O(logN)', async () => await client.zIncrBy(P + 'z', 1, 'a'));

console.log('--- pub/sub (count subscribers) ---');
await check('PUBSUB CHANNELS', 'O(N)', async () => await client.sendCommand(['PUBSUB', 'CHANNELS']));

console.log('--- info ---');
await check('INFO server', 'O(1)', async () => await client.info('server').then(s => s.match(/redis_version:(\S+)/)[1]));
await check('DBSIZE', 'O(1)', async () => await client.dbSize());
await check('COMMAND COUNT', 'O(1)', async () => await client.commandCount());

// cleanup
const scan = async (pat) => { const f = []; let cur = '0'; do { const r = await client.scan(cur, { MATCH: pat, COUNT: 1000 }); cur = r.cursor; f.push(...r.keys); } while (cur !== '0'); return f; };
const found = await scan(`${P}*`);
if (found.length) await client.del(found);
if (keys.length) await client.del(keys);
console.log('\nDBSIZE after cleanup:', await client.dbSize());
await client.close();
console.log('smoke test complete');