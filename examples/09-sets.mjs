/**
 * Chapter 09 - Sets
 * Run:  node examples/09-sets.mjs
 */
import { createClient } from 'redis';

const client = createClient({ url: 'redis://127.0.0.1:6379' });
await client.connect();

const P = 'ch09:';
const keys = [];

// ---------------------------------------------------------------------------
// 1. Add, test, remove. Membership test is O(1).
// ---------------------------------------------------------------------------
// ⚠️ Again: multiple members must be an ARRAY in node-redis 6.
await client.sAdd(P + 'tags', ['redis', 'nosql', 'cache']); keys.push(P + 'tags');

console.log('--- basics ---');
console.log('SCARD      ->', await client.sCard(P + 'tags'));
console.log('SISMEMBER  ->', await client.sIsMember(P + 'tags', 'redis'));
console.log('SISMEMBER  ->', await client.sIsMember(P + 'tags', 'mongo'), '(0 = not a member)');
console.log('sIsMember redis,nosql,mongo ->', await client.sIsMember(P + 'tags', 'redis'), '(single member only)');
console.log('smIsMember redis,nosql,mongo ->', await client.smIsMember(P + 'tags', ['redis', 'nosql', 'mongo']), '(array)');
console.log('SMEMBERS   ->', (await client.sMembers(P + 'tags')).sort());

// duplicates are silently ignored -- that is what makes it a SET
console.log('SADD redis again ->', await client.sAdd(P + 'tags', ['redis']), '(0 = already there)');
console.log('SCARD still      ->', await client.sCard(P + 'tags'));
console.log('SREM cache       ->', await client.sRem(P + 'tags', ['cache']));
console.log('after SREM       ->', (await client.sMembers(P + 'tags')).sort());

// ---------------------------------------------------------------------------
// 2. The varargs trap, same as lists
// ---------------------------------------------------------------------------
await client.del(P + 'bad');
await client.sAdd(P + 'bad', 'a', 'b', 'c');
console.log('\n--- ⚠️ varargs trap ---');
console.log("sAdd(key,'a','b','c')      ->", (await client.sMembers(P + 'bad')).sort(),
            ' ← only "a" stored');
await client.del(P + 'bad');
await client.sAdd(P + 'bad', ['a', 'b', 'c']);
console.log("sAdd(key,['a','b','c'])   ->", (await client.sMembers(P + 'bad')).sort(), ' ✓');
keys.push(P + 'bad');
await client.del(keys.splice(0));

// ---------------------------------------------------------------------------
// 3. Set algebra -- the genuinely useful part
// ---------------------------------------------------------------------------
await client.sAdd(P + 'a', ['1', '2', '3', '4']); keys.push(P + 'a');
await client.sAdd(P + 'b', ['3', '4', '5', '6']); keys.push(P + 'b');

// NOTE: sInter/sUnion/sDiff take a keys ARRAY (RedisVariadicArgument),
// not separate arguments -- passing (a, b) silently ignores b.
console.log('\n--- set algebra ---');
console.log('A        ->', (await client.sMembers(P + 'a')).sort());
console.log('B        ->', (await client.sMembers(P + 'b')).sort());
console.log('A ∩ B    ->', (await client.sInter([P + 'a', P + 'b'])).sort());
console.log('A ∪ B    ->', (await client.sUnion([P + 'a', P + 'b'])).sort());
console.log('A − B    ->', (await client.sDiff([P + 'a', P + 'b'])).sort());
console.log('|A ∩ B|  ->', await client.sInterCard([P + 'a', P + 'b']));

// store the result under a new key -- useful for precomputed joins
await client.sDiffStore(P + 'onlyA', P + 'a', P + 'b'); keys.push(P + 'onlyA');
console.log('SDIFFSTORE onlyA ->', (await client.sMembers(P + 'onlyA')).sort());

// ---------------------------------------------------------------------------
// 4. Real use case: find articles carrying ALL of the required tags
// ---------------------------------------------------------------------------
console.log('\n--- real use: find articles tagged BOTH redis AND nosql ---');
// Each article is a SET of its tags.
await client.sAdd(P + 'art:1', ['redis', 'nosql']); keys.push(P + 'art:1');
await client.sAdd(P + 'art:2', ['redis', 'cache']); keys.push(P + 'art:2');
await client.sAdd(P + 'art:3', ['postgres', 'sql']); keys.push(P + 'art:3');
await client.sAdd(P + 'art:4', ['redis', 'nosql', 'cache']); keys.push(P + 'art:4');

// Build an index: for each tag, the set of articles that have it.
await client.sAdd(P + 'bytag:redis', ['art:1', 'art:2', 'art:4']);
await client.sAdd(P + 'bytag:nosql', ['art:1', 'art:4']); keys.push(P + 'bytag:nosql', P + 'bytag:redis');

// Articles having redis AND nosql = intersection of the two tag indexes.
const both = (await client.sInter([P + 'bytag:redis', P + 'bytag:nosql'])).sort();
console.log('redis AND nosql ->', both, '  (expected art:1, art:4)');
console.log('  ^ one round trip, done inside Redis');
console.log('  articles with redis only ->', (await client.sDiff([P + 'bytag:redis', P + 'bytag:nosql'])).sort());
console.log('  articles with either    ->', (await client.sUnion([P + 'bytag:redis', P + 'bytag:nosql'])).sort());

// ---------------------------------------------------------------------------
// 5. SMEMBERS is O(N) -- the command to avoid on big sets
// ---------------------------------------------------------------------------
console.log('\n--- SMEMBERS cost ---');
const cfg = await client.configGet('set-max-listpack-entries');
console.log('set-max-listpack-entries :', cfg['set-max-listpack-entries']);

await client.del(P + 'big');
await client.sAdd(P + 'big', Array.from({ length: 2000 }, (_, i) => 'm' + i)); keys.push(P + 'big');
console.log('SCARD 2000 ->', await client.sCard(P + 'big'), '(O(1))');
console.log('encoding   ->', await client.objectEncoding(P + 'big'),
            `(${await client.memoryUsage(P + 'big')} bytes)`);
console.log('SMEMBERS   -> ', (await client.sMembers(P + 'big')).length, 'elements returned (O(N) over the wire)');

// SSCAN instead for big sets
let batches = 0, seen = 0;
for await (const members of client.sScanIterator(P + 'big', { COUNT: 200 })) {
  batches++; seen += members.length;
}
console.log(`sScanIterator -> ${seen} members in ${batches} batches (no huge reply)`);

// ---------------------------------------------------------------------------
// 6. SRANDMEMBER vs SPOP -- read-only vs destructive
// ---------------------------------------------------------------------------
console.log('\n--- SRANDMEMBER vs SPOP ---');
// sRandMember / sPop take ONLY a key. For a count use the _COUNT variants.
const before = await client.sCard(P + 'big');
const sampled = await client.sRandMember(P + 'big');
const three = await client.sRandMemberCount(P + 'big', 3);
const afterSample = await client.sCard(P + 'big');
console.log(`sRandMember()        -> ${JSON.stringify(sampled)} (1 random member)`);
console.log(`sRandMemberCount(k,3)-> ${three.length} members, SCARD ${before} -> ${afterSample} (unchanged)`);

const popped = await client.sPop(P + 'big');
const two = await client.sPopCount(P + 'big', 2);
const afterPop = await client.sCard(P + 'big');
console.log(`sPop()               -> ${JSON.stringify(popped)}`);
console.log(`sPopCount(k,2)       -> ${two.length} members, SCARD ${afterSample} -> ${afterPop} (REMOVED)`);

// negative count = sampling WITH repeats
const withRepeat = await client.sendCommand(['SRANDMEMBER', P + 'big', '-10']);
console.log(`SRANDMEMBER -10      -> ${withRepeat.length} picks, ${new Set(withRepeat).size} distinct (repeats allowed)`);

// ---------------------------------------------------------------------------
// 7. SINTERCARD with LIMIT -- avoiding scanning every set
// ---------------------------------------------------------------------------
await client.sAdd(P + 'allids', Array.from({ length: 5000 }, (_, i) => 'u' + i)); keys.push(P + 'allids');
await client.sAdd(P + 'goldusers', Array.from({ length: 300 }, (_, i) => 'u' + i)); keys.push(P + 'goldusers');
console.log('\n--- SINTERCARD LIMIT ---');
console.log('|allids ∩ goldusers|        ->', await client.sInterCard([P + 'allids', P + 'goldusers']));
console.log('...LIMIT 3 (stops early)    ->', await client.sInterCard([P + 'allids', P + 'goldusers'], { LIMIT: 3 }),
            '(stops as soon as 3 matches are found)');

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------
await client.del(keys);
console.log('\nDBSIZE after cleanup:', await client.dbSize());
await client.close();