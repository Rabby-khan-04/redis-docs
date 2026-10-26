/**
 * Chapter 22 - Memory and eviction
 * Run:  node examples/22-memory-and-eviction.mjs
 */
import { createClient } from 'redis';

const client = createClient({ url: 'redis://127.0.0.1:6379' });
await client.connect();

const P = 'ch22:';
const keys = [];

// ---------------------------------------------------------------------------
// 1. Memory introspection
// ---------------------------------------------------------------------------
console.log('--- memory introspection ---');
const info = await client.info('memory');
const pick = (re) => info.match(re)?.[1] ?? '(n/a)';
console.log('used_memory_human      ->', pick(/used_memory_human:(\S+)/));
console.log('used_memory_peak_human ->', pick(/used_memory_peak_human:(\S+)/));
console.log('used_memory_peak_perc  ->', pick(/used_memory_peak_perc:(\S+)/));
console.log('maxmemory_human       ->', pick(/maxmemory_human:(\S+)/));
console.log('maxmemory_policy      ->', pick(/maxmemory_policy:(\S+)/));
console.log('mem_fragmentation_ratio->', pick(/mem_fragmentation_ratio:(\S+)/));
console.log('allocator             ->', pick(/mem_allocator:(\S+)/));

// ---------------------------------------------------------------------------
// 2. Per-key cost
// ---------------------------------------------------------------------------
console.log('\n--- per-key cost ---');
await client.set(P + 'small', 'hello'); keys.push(P + 'small');
await client.set(P + 'medium', 'x'.repeat(200)); keys.push(P + 'medium');
await client.hSet(P + 'hash', { a: '1', b: '2', c: '3' }); keys.push(P + 'hash');

for (const k of [P + 'small', P + 'medium', P + 'hash']) {
  console.log(`  ${k.padEnd(16)} ${String(await client.objectEncoding(k)).padEnd(10)} ${await client.memoryUsage(k)} bytes`);
}

// ---------------------------------------------------------------------------
// 3. maxmemory and the 8 policies
// ---------------------------------------------------------------------------
console.log('\n--- maxmemory and policies ---');
console.log('maxmemory         ->', (await client.configGet('maxmemory')).maxmemory, '(0 = unlimited)');
console.log('maxmemory-policy  ->', (await client.configGet('maxmemory-policy'))['maxmemory-policy']);
console.log('maxmemory-clients ->', (await client.configGet('maxmemory-clients'))['maxmemory-clients']);
console.log('maxmemory-eviction-tenacity ->', (await client.configGet('maxmemory-eviction-tenacity'))['maxmemory-eviction-tenacity']);

// ---------------------------------------------------------------------------
// 4. MEMORY commands
// ---------------------------------------------------------------------------
console.log('\n--- MEMORY commands ---');
console.log('MEMORY USAGE small ->', await client.memoryUsage(P + 'small'));
console.log('MEMORY total.allocated ->', (await client.memoryStats())['total.allocated']);
console.log('MEMORY startup.allocated ->', (await client.memoryStats())['startup.allocated']);
console.log('MEMORY DOCTOR ->', (await client.memoryDoctor()).slice(0, 80));

// ---------------------------------------------------------------------------
// 5. MEMORY USAGE with SAMPLES (exactness)
// ---------------------------------------------------------------------------
console.log('\n--- MEMORY USAGE sampling ---');
await client.del(P + 'big');
for (let i = 0; i < 1000; i++) await client.hSet(P + 'big', 'f' + i, 'v' + i);
keys.push(P + 'big');
console.log('MEMORY USAGE sample 0 (default) ->', await client.memoryUsage(P + 'big'));
console.log('MEMORY USAGE SAMPLES 10         ->', await client.sendCommand(['MEMORY', 'USAGE', P + 'big', 'SAMPLES', '10']));
console.log('  (0 = exact but O(N) for nested types; default samples 5)');

// ---------------------------------------------------------------------------
// 6. Eviction policies: simulate by setting maxmemory tiny
// ---------------------------------------------------------------------------
console.log('\n--- simulating eviction ---');
const before = await client.configGet('maxmemory');
const beforePol = await client.configGet('maxmemory-policy');
console.log('before: maxmemory =', before.maxmemory, ' policy =', beforePol['maxmemory-policy']);

// Set a tiny maxmemory so eviction kicks in (this is a demo only)
const startupMem = (await client.memoryStats())['startup.allocated'];
const target = startupMem + 1 * 1024 * 1024;
await client.configSet('maxmemory', String(target));
await client.configSet('maxmemory-policy', 'allkeys-lru');
console.log(`set maxmemory=${(target/1024/1024).toFixed(1)}MB (startup+1MB), policy=allkeys-lru`);
// Add more data than 1 MB, swallowing the inevitable OOMs
let written = 0, oom = 0;
for (let i = 0; i < 2000; i++) {
  try {
    await client.set(`${P}evict:${i}`, 'x'.repeat(500));
    written++;
  } catch (e) {
    oom++;
  }
}
console.log(`tried 2000 keys -> ${written} written, ${oom} OOM-refused`);
console.log('DBSIZE now ->', await client.dbSize(), '(eviction may have removed keys to stay under 1 MB)');
console.log('evicted_count ->', (await client.info('stats')).match(/evicted_keys:(\d+)/)?.[1]);

// Restore
await client.configSet('maxmemory', before.maxmemory);
await client.configSet('maxmemory-policy', beforePol['maxmemory-policy']);
console.log('restored maxmemory and policy');

// ---------------------------------------------------------------------------
// 7. ⚠️ noeviction: writes fail instead of deleting
// ---------------------------------------------------------------------------
console.log('\n--- noeviction behaviour ---');
await client.configSet('maxmemory', '1mb');
await client.configSet('maxmemory-policy', 'noeviction');
console.log('set maxmemory=1mb, policy=noeviction');
let gotError = null;
for (let i = 0; i < 100; i++) {
  try {
    await client.set(`${P}ne:${i}`, 'x'.repeat(500));
  } catch (e) {
    gotError = e.message;
    break;
  }
}
console.log('after filling up memory: error =', gotError, '(noeviction refuses writes once full)');
await client.configSet('maxmemory', before.maxmemory);
await client.configSet('maxmemory-policy', beforePol['maxmemory-policy']);
console.log('restored');

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------
const scan = async (pattern) => {
  const found = [];
  let cur = '0';
  do {
    const r = await client.scan(cur, { MATCH: pattern, COUNT: 1000 });
    cur = r.cursor;
    found.push(...r.keys);
  } while (cur !== '0');
  return found;
};
async function delPattern(pattern) {
  const found = await scan(pattern);
  if (found.length === 0) return 0;
  for (let i = 0; i < found.length; i += 500) await client.del(found.slice(i, i + 500));
  return found.length;
}
if (keys.length) await client.del(keys);
await delPattern(`${P}evict:*`);
await delPattern(`${P}ne:*`);
console.log('\nDBSIZE after cleanup:', await client.dbSize());
await client.close();