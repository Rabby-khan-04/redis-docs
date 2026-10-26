/**
 * Chapter 11a - Bitmaps and bitfields (part 1)
 * Run:  node examples/11a-bitmaps.mjs
 */
import { createClient } from 'redis';

const client = createClient({ url: 'redis://127.0.0.1:6379' });
await client.connect();

const P = 'ch11a:';
const keys = [];

// ---------------------------------------------------------------------------
// 1. A bit is one byte's worth of a byte. Offset 7 is the LAST bit of byte 0.
// ---------------------------------------------------------------------------
console.log('--- the basics ---');
await client.setBit(P + 'bm', 7, 1); keys.push(P + 'bm');
console.log('after SETBIT bm 7 1');
console.log('  GETBIT 7 ->', await client.getBit(P + 'bm', 7));
console.log('  GETBIT 6 ->', await client.getBit(P + 'bm', 6));
console.log('  BITCOUNT ->', await client.bitCount(P + 'bm'), 'bits set');
console.log('  STRLEN   ->', await client.strLen(P + 'bm'), 'bytes used (1 byte holds bits 0-7)');

console.log('  SETBIT returns the OLD value:');
console.log('  SETBIT 7 1 again ->', await client.setBit(P + 'bm', 7, 1), '(was already 1)');
console.log('  SETBIT 7 0      ->', await client.setBit(P + 'bm', 7, 0), '(returns previous 1)');

// ---------------------------------------------------------------------------
// 2. Memory maths -- the whole reason bitmaps exist
// ---------------------------------------------------------------------------
console.log('\n--- memory: why bitmaps exist ---');
await client.setBit(P + 'u', 1_000_000, 1); keys.push(P + 'u');
console.log('SETBIT u 1000000 1');
console.log('  STRLEN      ->', await client.strLen(P + 'u'), 'bytes =', await client.strLen(P + 'u') / 8, 'KB');
console.log('  MEMORY USAGE->', await client.memoryUsage(P + 'u'), 'bytes total');
console.log('  1,000,001 users need', (1_000_001 / 8 / 1024).toFixed(0), 'KB as a bitmap');
console.log('  as individual keys they would need ~100 MB+ (each key has overhead)');

// ---------------------------------------------------------------------------
// 3. BITCOUNT and BITPOS
// ---------------------------------------------------------------------------
console.log('\n--- BITCOUNT / BITPOS ---');
await client.del(P + 'days');
// pretend users 0..9 were active, 5 and 3 were not
for (const id of [0, 1, 2, 4, 5, 6, 7, 8, 9]) await client.setBit(P + 'days', id, 1);
keys.push(P + 'days');
console.log('10 users, one inactive (bit 3)');
console.log('  BITCOUNT       ->', await client.bitCount(P + 'days'));
console.log('  BITPOS 1       ->', await client.bitPos(P + 'days', 1), '(first set bit)');
console.log('  BITPOS 0       ->', await client.bitPos(P + 'days', 0), '(first unset bit)');
// ⚠️ the range is an OBJECT: bitCount(key, { start, end }), not positional args
console.log('  BITCOUNT {start:0,end:0} ->', await client.bitCount(P + 'days', { start: 0, end: 0 }), '(byte 0 only = 7 bits)');
console.log('  BITCOUNT {start:1,end:1} ->', await client.bitCount(P + 'days', { start: 1, end: 1 }), '(byte 1 only = 2 bits)');
console.log('  BITCOUNT {start:0,end:-1}->', await client.bitCount(P + 'days', { start: 0, end: -1 }));

// ---------------------------------------------------------------------------
// 4. Why one bit is not enough: BITFIELD packs counters into bytes
// ---------------------------------------------------------------------------
console.log('\n--- BITFIELD: many counters in one key ---');
await client.del(P + 'bf');
console.log('SET u8 0 255 + GET u8 0   ->',
  await client.sendCommand(['BITFIELD', P + 'bf', 'SET', 'u8', '0', '255', 'GET', 'u8', '0']));
console.log('INCRBY u8 0 10 + GET     ->',
  await client.sendCommand(['BITFIELD', P + 'bf', 'INCRBY', 'u8', '0', '10', 'GET', 'u8', '0']),
  '  (255 + 10 wrapped to 9)');

console.log('\nOVERFLOW modes (what happens when the counter would exceed its width):');
await client.del(P + 'of');
console.log('  WRAP (default) i8 +200 ->',
  await client.sendCommand(['BITFIELD', P + 'of', 'OVERFLOW', 'WRAP', 'INCRBY', 'i8', '0', '200', 'GET', 'i8', '0']),
  '  (wraps around, signed so it goes negative)');
await client.del(P + 'of');
console.log('  SAT  u8 +250         ->',
  await client.sendCommand(['BITFIELD', P + 'of', 'OVERFLOW', 'SAT', 'INCRBY', 'u8', '0', '250', 'GET', 'u8', '0']),
  '  (saturates at the max, 255)');
console.log('  FAIL u8 +250         ->',
  await client.sendCommand(['BITFIELD', P + 'of', 'OVERFLOW', 'FAIL', 'INCRBY', 'u8', '0', '250', 'GET', 'u8', '0']),
  '  (returns nil, value unchanged)');

// ---------------------------------------------------------------------------
// 5. Atomic multi-counter update
// ---------------------------------------------------------------------------
console.log('\n--- BITFIELD is atomic across counters ---');
// offsets are BIT offsets: u16 0 = bits 0-15, u16 16 = bits 16-31
await client.del(P + 'hits');
const res = await client.multi()
  .sendCommand(['BITFIELD', P + 'hits', 'INCRBY', 'u16', '0', '1', 'INCRBY', 'u16', '16', '1'])
  .sendCommand(['BITFIELD', P + 'hits', 'GET', 'u16', '0', 'GET', 'u16', '16'])
  .exec();
console.log('INCRBY u16@0 and u16@16 in one BITFIELD ->', res[0]);
console.log('then GET both                            ->', res[1]);
keys.push(P + 'hits');

// ---------------------------------------------------------------------------
// 6. Real use: daily signups as a bitmap
// ---------------------------------------------------------------------------
console.log('\n--- real use: were users active today? ---');
await client.del(P + 'active');
const today = ['1', '7', '42', '99', '100', '101'];
for (const u of today) await client.setBit(P + 'active', Number(u), 1);
keys.push(P + 'active');
console.log('marked users active:', today.join(', '));
for (const u of ['1', '42', '100']) {
  console.log(`  is user ${u} active? -> ${await client.getBit(P + 'active', Number(u)) === 1}`);
}
console.log(`  total active today: ${await client.bitCount(P + 'active')}`);

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------
await client.del([...keys, P + 'bf', P + 'of', P + 'days', P + 'hits']);
console.log('\nDBSIZE after cleanup:', await client.dbSize());
await client.close();