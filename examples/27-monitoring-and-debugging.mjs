/**
 * Chapter 27 - Monitoring and debugging
 * Run:  node examples/27-monitoring-and-debugging.mjs
 */
import { createClient } from 'redis';

const client = createClient({ url: 'redis://127.0.0.1:6379' });
await client.connect();

const P = 'ch27:';
const keys = [];

console.log('--- memory introspection ---');
const info = await client.info('memory');
const pick = (re) => info.match(re)?.[1] ?? '(n/a)';
console.log('used_memory_human      ->', pick(/used_memory_human:(\S+)/));
console.log('used_memory_peak_human ->', pick(/used_memory_peak_human:(\S+)/));
console.log('maxmemory_human       ->', pick(/maxmemory_human:(\S+)/));
console.log('maxmemory_policy      ->', pick(/maxmemory_policy:(\S+)/));
console.log('mem_fragmentation_ratio->', pick(/mem_fragmentation_ratio:(\S+)/));

console.log('\n--- per-key introspection ---');
await client.set(P + 'small', 'hello'); keys.push(P + 'small');
await client.set(P + 'medium', 'x'.repeat(200)); keys.push(P + 'medium');
await client.hSet(P + 'hash', { a: '1', b: '2', c: '3' }); keys.push(P + 'hash');
for (const k of [P + 'small', P + 'medium', P + 'hash']) {
  console.log(`  ${k.padEnd(16)} ${String(await client.objectEncoding(k)).padEnd(10)} ${await client.memoryUsage(k)} bytes`);
}

console.log('\n--- INFO sections via client.info() ---');
const serverInfo = await client.info('server');
console.log('server redis_version ->', serverInfo.match(/redis_version:(\S+)/)[1]);
const memInfo = await client.info('memory');
console.log('memory used_memory_human ->', memInfo.match(/used_memory_human:(\S+)/)[1]);
const statsInfo = await client.info('stats');
console.log('stats total_commands_processed ->', statsInfo.match(/total_commands_processed:(\S+)/)[1]);
const ksInfo = await client.info('keyspace');
console.log('keyspace ->', ksInfo.split('\n').find(l => l.startsWith('db0')));

console.log('\n--- SLOWLOG via client ---');
// trigger a slow command
await client.eval('for i=1,4000000 do local x=i*i end return 1', { keys: [], arguments: [] });
const slowlog = await client.sendCommand(['SLOWLOG', 'GET', '5']);
console.log('slowlog len ->', await client.sendCommand(['SLOWLOG', 'LEN']));
console.log('slowlog entry ->', JSON.stringify(slowlog[0]).slice(0, 160));
await client.sendCommand(['SLOWLOG', 'RESET']);
console.log('slowlog len after reset ->', await client.sendCommand(['SLOWLOG', 'LEN']));

console.log('\n--- LATENCY via client ---');
const lat = await client.sendCommand(['LATENCY', 'LATEST']);
console.log('latency latest ->', JSON.stringify(lat));

console.log('\n--- CLIENT LIST via client ---');
const ci = await client.sendCommand(['CLIENT', 'INFO']);
console.log('client info ->', ci.split(' ').find(t => t.startsWith('lib-')) + ' ' +
  ci.split(' ').find(t => t.startsWith('resp=')));

console.log('\n--- COMMAND STATS ---');
const cs = await client.info('commandstats');
const first = cs.split('\n').find(l => l.startsWith('cmdstat_'));
console.log('cmdstat_get ->', first);

console.log('\n--- MEMORY USAGE sampling ---');
await client.del(P + 'big');
for (let i = 0; i < 1000; i++) await client.hSet(P + 'big', 'f' + i, 'v' + i);
keys.push(P + 'big');
console.log('small  ->', await client.memoryUsage(P + 'small'), 'bytes (exact SAMPLES 0)');
console.log('big    ->', await client.memoryUsage(P + 'big'), 'bytes (default SAMPLES 5)');
console.log('big exact ->', await client.sendCommand(['MEMORY', 'USAGE', P + 'big', 'SAMPLES', '0']));

console.log('\n--- health() helper ---');
async function health(c) {
  const m = await c.info('memory');
  const st = await c.info('stats');
  const used = Number(m.match(/used_memory:(\d+)/)[1]);
  const max = Number((await c.configGet('maxmemory')).maxmemory);
  const frag = Number(m.match(/mem_fragmentation_ratio:(\S+)/)[1]);
  const hits = Number(st.match(/keyspace_hits:(\d+)/)[1]);
  const misses = Number(st.match(/keyspace_misses:(\d+)/)[1]);
  return {
    usedMB: (used / 1024 / 1024).toFixed(2),
    maxMB: max ? (max / 1024 / 1024).toFixed(0) : 'unlimited',
    fragmentation: frag.toFixed(2),
    hitRate: (hits + misses) ? ((hits / (hits + misses)) * 100).toFixed(1) + '%' : 'n/a',
  };
}
console.log('health ->', await health(client));

// cleanup
const scan = async (pat) => { const f = []; let cur = '0'; do { const r = await client.scan(cur, { MATCH: pat, COUNT: 1000 }); cur = r.cursor; f.push(...r.keys); } while (cur !== '0'); return f; };
const found = await scan(`${P}*`);
if (found.length) await client.del(found);
console.log('\nDBSIZE after cleanup:', await client.dbSize());
await client.close();