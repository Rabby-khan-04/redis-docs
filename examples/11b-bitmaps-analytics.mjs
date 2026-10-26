/**
 * Chapter 11b - Bitmaps (part 2): BITOP and real analytics
 * Run:  node examples/11b-bitmaps-analytics.mjs
 */
import { createClient } from 'redis';

const client = createClient({ url: 'redis://127.0.0.1:6379' });
await client.connect();

const P = 'ch11b:';
const keys = [];

// ---------------------------------------------------------------------------
// 1. BITOP -- combine whole bitmaps with AND / OR / XOR / NOT
// ---------------------------------------------------------------------------
console.log('--- BITOP ---');
// day1: users 0,1,2,3 ;  day2: users 2,3,4
await client.setBit(P + 'day1', 0, 1); await client.setBit(P + 'day1', 1, 1);
await client.setBit(P + 'day1', 2, 1); await client.setBit(P + 'day1', 3, 1);
await client.setBit(P + 'day2', 2, 1); await client.setBit(P + 'day2', 3, 1);
await client.setBit(P + 'day2', 4, 1);
keys.push(P + 'day1', P + 'day2');

const show = async (k) => {
  const out = [];
  for (let i = 0; i < 6; i++) out.push(await client.getBit(k, i));
  return out.join('');
};

console.log('day1 bits 0-5 ->', await show(P + 'day1'), '(users 0,1,2,3)');
console.log('day2 bits 0-5 ->', await show(P + 'day2'), '(users 2,3,4)');

await client.sendCommand(['BITOP', 'AND', P + 'both', P + 'day1', P + 'day2']); keys.push(P + 'both');
await client.sendCommand(['BITOP', 'OR', P + 'either', P + 'day1', P + 'day2']); keys.push(P + 'either');
await client.sendCommand(['BITOP', 'XOR', P + 'xor', P + 'day1', P + 'day2']); keys.push(P + 'xor');
await client.sendCommand(['BITOP', 'NOT', P + 'notday1', P + 'day1']); keys.push(P + 'notday1');

console.log('AND  (both days)     ->', await show(P + 'both'), '  users 2,3');
console.log('OR   (either day)    ->', await show(P + 'either'), '  users 0,1,2,3,4');
console.log('XOR  (exactly one)   ->', await show(P + 'xor'), '  users 0,1,4');
console.log('NOT  (invert day1)   ->', await show(P + 'notday1'), '  (all EXCEPT 0,1,2,3)');
console.log('BITCOUNT of AND      ->', await client.bitCount(P + 'both'), '= users active on BOTH days');

// ---------------------------------------------------------------------------
// 2. BITPOS -- find the FIRST matching bit (there is no "last" command)
// ---------------------------------------------------------------------------
console.log('\n--- BITPOS ---');
console.log('first set bit in day1   ->', await client.bitPos(P + 'day1', 1));
console.log('first unset bit in day1 ->', await client.bitPos(P + 'day1', 0));
console.log('BITPOS only searches FORWARD. `bitPos(key, 1, -1)` still gives the first');
console.log('bit of the LAST byte -- there is no built-in "last set bit".');
console.log('  bitPos(day1,1,-1) ->', await client.bitPos(P + 'day1', 1, -1));

// ---------------------------------------------------------------------------
// 3. ⭐ The real analytics pattern: unique users per day, one bitmap per day
// ---------------------------------------------------------------------------
console.log('\n--- real analytics: weekly unique users ---');
const USERS = 50;
const days = ['mon', 'tue', 'wed', 'thu', 'fri'];

// build a week of activity deterministically so the numbers are reproducible
let seed = 7;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

const allUsers = [];
for (const day of days) {
  await client.del(`${P}w:${day}`);
  const active = new Set();
  for (let u = 0; u < USERS; u++) if (rand() < 0.4) { active.add(u); await client.setBit(`${P}w:${day}`, u, 1); }
  allUsers.push([day, [...active]]);
  keys.push(`${P}w:${day}`);
}

console.log(`50 users, 40% chance of activity each day:`);
for (const [day, users] of allUsers) {
  console.log(`  ${day}: BITCOUNT=${await client.bitCount(`${P}w:${day}`)}`);
}

// unique users across the whole week = OR all days together
await client.sendCommand(['BITOP', 'OR', P + 'week', ...days.map(d => `${P}w:${d}`)]);
keys.push(P + 'week');
const weekUnique = await client.bitCount(P + 'week');
console.log(`\nOR of all 5 days, BITCOUNT -> ${weekUnique} unique users in the week`);
console.log('  (sum of daily counts is much larger:', allUsers.reduce((a, [, u]) => a + u.length, 0) + ')');

// daily active user counts via one BITOP per day
console.log('\ndaily unique vs returning:');
const seenBefore = new Set();
for (const [day, users] of allUsers) {
  const returning = users.filter(u => seenBefore.has(u)).length;
  console.log(`  ${day}: active=${users.length} new=${users.length - returning} returning=${returning}`);
  users.forEach(u => seenBefore.add(u));
}

// ---------------------------------------------------------------------------
// 4. Bit offset maths -- the "gotcha" with byte alignment
// ---------------------------------------------------------------------------
console.log('\n--- bit offset maths ---');
await client.del(P + 'off');
console.log('8 bits   = 1 byte   -> ceil(8/8)   =', Math.ceil(8 / 8), 'byte');
console.log('100 bits = 12.5 B   -> ceil(100/8) =', Math.ceil(100 / 8), 'bytes');
console.log('1,000,000 bits      -> ceil(1e6/8) =', Math.ceil(1e6 / 8), 'bytes =',
            (Math.ceil(1e6 / 8) / 1024).toFixed(0), 'KB');

await client.setBit(P + 'off', 99, 1);
console.log('SETBIT 99 -> STRLEN', await client.strLen(P + 'off'), 'bytes (bit 99 is in byte 12)');
keys.push(P + 'off');

// ---------------------------------------------------------------------------
// 5. How fast is BITCOUNT? It is O(N/8) - still linear
// ---------------------------------------------------------------------------
console.log('\n--- is BITCOUNT fast? ---');
await client.del(P + 'huge');
for (let i = 0; i < 1_000_000; i += 4) await client.setBit(P + 'huge', i, 1); // 250k set bits
keys.push(P + 'huge');
console.log('bitmap of 1,000,000 bits with 250,000 set');
console.log('  bytes  ->', await client.strLen(P + 'huge'));
let t = process.hrtime.bigint();
const n = await client.bitCount(P + 'huge');
console.log(`  BITCOUNT -> ${n} in ${(Number(process.hrtime.bigint() - t) / 1e6).toFixed(2)}ms`);
console.log('  O(number of bytes) -- 125 KB to walk. Fast, but NOT O(1).');

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------
await client.del(keys);
console.log('\nDBSIZE after cleanup:', await client.dbSize());
await client.close();