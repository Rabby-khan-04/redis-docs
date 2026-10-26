/**
 * Chapter 10 - Sorted sets
 * Run:  node examples/10-sorted-sets.mjs
 */
import { createClient } from 'redis';

const client = createClient({ url: 'redis://127.0.0.1:6379' });
await client.connect();

const P = 'ch10:';
const keys = [];

// ---------------------------------------------------------------------------
// 1. A set where every member also has a NUMBER
// ---------------------------------------------------------------------------
await client.zAdd(P + 'lb', [
  { score: 10, value: 'alice' },
  { score: 20, value: 'bob' },
  { score: 5, value: 'carol' },
]); keys.push(P + 'lb');

console.log('--- basics ---');
console.log('ZCARD      ->', await client.zCard(P + 'lb'));
console.log('ZSCORE bob ->', await client.zScore(P + 'lb', 'bob'));
console.log('ZSCORE zzz ->', await client.zScore(P + 'lb', 'zzz'), '(null = not a member)');
console.log('ZRANGE asc ->', await client.zRangeWithScores(P + 'lb', 0, -1));
console.log('ZREVRANGE  ->', await client.zRangeWithScores(P + 'lb', 0, -1, { REV: true }));

// ---------------------------------------------------------------------------
// 2. The leaderboard: ZINCRBY + rank
// ---------------------------------------------------------------------------
console.log('\n--- leaderboard ---');
console.log('ZINCRBY alice 15 ->', await client.zIncrBy(P + 'lb', 15, 'alice'));
console.log('ZINCRBY alice 5  ->', await client.zIncrBy(P + 'lb', 5, 'alice'), '(alice is now 30)');
console.log('board (best first) ->', await client.zRangeWithScores(P + 'lb', 0, -1, { REV: true }));
console.log('alice rank (0-based, best=0) ->', await client.zRank(P + 'lb', 'alice'));
console.log('ZREVRANK (best = 0)          ->', await client.zRevRank(P + 'lb', 'alice'));
console.log('alice rank with score        ->', await client.zRankWithScore(P + 'lb', 'alice'));

// ---------------------------------------------------------------------------
// 3. Ranking by position, not by score
// ---------------------------------------------------------------------------
console.log('\n--- top N ---');
console.log('top 2 ->', await client.zRangeWithScores(P + 'lb', 0, 1, { REV: true }));
console.log('rank 0..1 (2nd to 1st) ->', await client.zRangeWithScores(P + 'lb', 0, 1));

// ---------------------------------------------------------------------------
// 4. Query by score range
// ---------------------------------------------------------------------------
console.log('\n--- by score ---');
console.log('ZRANGEBYSCORE 10..30      ->', await client.zRangeByScoreWithScores(P + 'lb', 10, 30));
console.log('ZRANGEBYSCORE (10..+inf   ->', await client.zRangeByScoreWithScores(P + 'lb', '(10', '+inf'),
            '  ("(" means EXCLUSIVE)');
console.log('ZRANGEBYSCORE -inf..(20   ->', await client.zRangeByScoreWithScores(P + 'lb', '-inf', '(20'));
console.log('ZRANGEBYSCORE LIMIT 0 1   ->', await client.zRangeByScoreWithScores(P + 'lb', '-inf', '+inf', { LIMIT: { offset: 0, count: 1 } }));
console.log('ZCOUNT 10..30             ->', await client.zCount(P + 'lb', 10, 30));

// ZRANGE ... BYSCORE (the unified command, Redis 6.2+)
console.log('\n--- unified ZRANGE ---');
console.log('ZRANGE BYSCORE      ->', await client.sendCommand(['ZRANGE', P + 'lb', '10', '30', 'BYSCORE']));
console.log('ZRANGE BYSCORE REV  ->', await client.sendCommand(['ZRANGE', P + 'lb', '+inf', '10', 'BYSCORE', 'REV']),
            '  (note: REV flips min/max order!)');
console.log('ZRANGE BYSCORE WITHSCORES ->', await client.sendCommand(['ZRANGE', P + 'lb', '20', '+inf', 'BYSCORE', 'WITHSCORES']));

// ---------------------------------------------------------------------------
// 5. Pop the extremes -- perfect for "next job" or "top score"
// ---------------------------------------------------------------------------
console.log('\n--- ZPOPMIN / ZPOPMAX ---');
// zPopMin/zPopMax take ONLY a key; use the _COUNT variants for a count.
console.log('zPopMin()    ->', await client.zPopMin(P + 'lb'));
console.log('zPopMax()    ->', await client.zPopMax(P + 'lb'));
console.log('remaining ->', await client.zRangeWithScores(P + 'lb', 0, -1));
await client.del(P + 'lb'); keys.splice(0);

// ---------------------------------------------------------------------------
// 6. ZMSCORE -- many scores in one round trip
// ---------------------------------------------------------------------------
await client.zAdd(P + 'lb', [
  { score: 10, value: 'alice' }, { score: 20, value: 'bob' }, { score: 5, value: 'carol' },
]); keys.push(P + 'lb');
console.log('\n--- ZMSCORE (one round trip) ---');
console.log('alice,bob,nobody ->', await client.zmScore(P + 'lb', ['alice', 'bob', 'nobody']));

// ---------------------------------------------------------------------------
// 7. Sorted set algebra -- with score aggregation
// ---------------------------------------------------------------------------
await client.zAdd(P + 'z1', [{ score: 10, value: 'a' }, { score: 20, value: 'b' }]);
await client.zAdd(P + 'z2', [{ score: 15, value: 'a' }, { score: 5, value: 'c' }]); keys.push(P + 'z1', P + 'z2');
console.log('\n--- set algebra on sorted sets ---');
console.log('z1 ->', await client.zRangeWithScores(P + 'z1', 0, -1));
console.log('z2 ->', await client.zRangeWithScores(P + 'z2', 0, -1));
// ⚠️ zUnion's options object ONLY accepts AGGREGATE (no WITHSCORES key).
// For scores you must use the separate zUnionWithScores method.
console.log('UNION (values only)      ->', await client.zUnion([P + 'z1', P + 'z2']));
console.log('UNION SUM (with scores)  ->', await client.zUnionWithScores([P + 'z1', P + 'z2']));
console.log('UNION MAX (with scores)  ->', await client.zUnionWithScores([P + 'z1', P + 'z2'], { AGGREGATE: 'MAX' }));
console.log('INTER                    ->', await client.zInter([P + 'z1', P + 'z2']));
console.log('INTER WITHSCORES         ->', await client.zInterWithScores([P + 'z1', P + 'z2']));
// zDiff takes ONLY the keys array -- no options at all.
console.log('DIFF (z1 - z2)           ->', await client.zDiff([P + 'z1', P + 'z2']));
console.log('DIFF WITHSCORES          ->', await client.zDiffWithScores([P + 'z1', P + 'z2']));

// ---------------------------------------------------------------------------
// 8. Sorted sets as a priority queue (lowest score = highest priority)
// ---------------------------------------------------------------------------
console.log('\n--- priority queue ---');
await client.del(P + 'jobs');
await client.zAdd(P + 'jobs', [
  { score: 1, value: 'critical' }, { score: 5, value: 'normal' }, { score: 9, value: 'low' },
]); keys.push(P + 'jobs');
console.log('next job to run (lowest score) ->', await client.zPopMin(P + 'jobs'));
console.log('then ->', await client.zPopMin(P + 'jobs'));

// ---------------------------------------------------------------------------
// 9. Lexicographic range (needs all scores equal)
// ---------------------------------------------------------------------------
await client.del(P + 'names');
await client.zAdd(P + 'names', [
  { score: 0, value: 'alice' }, { score: 0, value: 'bob' }, { score: 0, value: 'carol' },
]); keys.push(P + 'names');
console.log('\n--- lexical order (all score 0) ---');
console.log('ZRANGEBYLEX - +    ->', await client.zRangeByLex(P + 'names', '-', '+'));
console.log('ZRANGEBYLEX [a c)  ->', await client.zRangeByLex(P + 'names', '[a', '(c'));
console.log('ZRANGE - + BYLEX   ->', await client.sendCommand(['ZRANGE', P + 'names', '-', '+', 'BYLEX']));

// ---------------------------------------------------------------------------
// 10. Encoding
// ---------------------------------------------------------------------------
console.log('\n--- encoding ---');
const cfg = await client.configGet('zset-max-listpack-entries');
console.log('zset-max-listpack-entries :', cfg['zset-max-listpack-entries']);
console.log('3 small members ->', await client.objectEncoding(P + 'z1'), `(${await client.memoryUsage(P + 'z1')} bytes)`);
await client.del(P + 'bigz');
for (let i = 0; i < 300; i++) await client.zAdd(P + 'bigz', [{ score: i, value: 'm' + i }]);
console.log('300 members     ->', await client.objectEncoding(P + 'bigz'), `(${await client.memoryUsage(P + 'bigz')} bytes)`);
keys.push(P + 'bigz');

// ---------------------------------------------------------------------------
// 11. Skip list proof: ranking is fast even when big
// ---------------------------------------------------------------------------
await client.del(P + 'race');
const N = 50000;
for (let i = 0; i < N; i += 1000) {
  await client.zAdd(P + 'race', Array.from({ length: 1000 }, (_, j) => ({ score: i + j, value: 'p' + (i + j) })));
}
keys.push(P + 'race');
let t = process.hrtime.bigint();
await client.zRank(P + 'race', 'p25000');
console.log(`\nZRANK in a ${N}-member zset: ${(Number(process.hrtime.bigint() - t) / 1e6).toFixed(2)}ms (skip list = O(log N))`);

t = process.hrtime.bigint();
await client.zRangeWithScores(P + 'race', 0, -1, { REV: true });
console.log(`Full ZRANGE of ${N} members:    ${(Number(process.hrtime.bigint() - t) / 1e6).toFixed(1)}ms (O(N) -- don't do this)`);

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------
await client.del(keys);
console.log('\nDBSIZE after cleanup:', await client.dbSize());
await client.close();