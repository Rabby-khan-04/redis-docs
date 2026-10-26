/**
 * Chapter 24 - Sentinel
 * Run:  node examples/24-sentinel.mjs
 *
 * Infra: redis-learn (primary) + redis-replica (replica) + redis-sentinel (port 26379).
 * The example stops the primary to trigger a real failover, then restarts it.
 */
import { createClient, createSentinel } from 'redis';

const SENTINEL = { host: '127.0.0.1', port: 26379 };
const sentinel = createSentinel({
  sentinelRootNodes: [SENTINEL],
  name: 'mymaster',
});
await sentinel.connect();

const P = 'ch24:';
const keys = [];

console.log('--- before failover ---');
console.log('sentinel PING ->', await sentinel.ping());
console.log('sentinel SET  ->', await sentinel.set(P + 'before', 'value'));
console.log('sentinel GET  ->', await sentinel.get(P + 'before'));
keys.push(P + 'before');

// Introspect via a plain connection to the sentinel
const si = createClient({ url: 'redis://127.0.0.1:26379' });
await si.connect();
console.log('\n--- sentinel introspection ---');
const masters = await si.sendCommand(['SENTINEL', 'MASTERS']);
console.log('SENTINEL MASTERS ->', masters.map(m => `${m.name} ${m.ip}:${m.port} (${m.flags})`).join(', '));
const addr = await si.sendCommand(['SENTINEL', 'GET-MASTER-ADDR-BY-NAME', 'mymaster']);
console.log('GET-MASTER-ADDR-BY-NAME mymaster ->', addr);
const replicas = await si.sendCommand(['SENTINEL', 'REPLICAS', 'mymaster']);
console.log('REPLICAS ->', replicas.length, 'replica(s):', replicas.map(r => `${r.ip}:${r.port} (${r.flags})`).join(', '));
const sentinels = await si.sendCommand(['SENTINEL', 'SENTINELS', 'mymaster']);
console.log('SENTINELS ->', sentinels.length, 'other sentinel(s)');

// ---------------------------------------------------------------------------
// 1. Failover: stop the primary, watch sentinel promote the replica
// ---------------------------------------------------------------------------
console.log('\n--- ⭐ failover ---');
const { execSync } = await import('node:child_process');
console.log('stopping the primary (docker stop redis-learn)...');
execSync('docker stop redis-learn');
console.log('waiting for sentinel to detect the failure and promote...');

let recovered = false;
for (let i = 0; i < 20; i++) {
  await new Promise(r => setTimeout(r, 1000));
  try {
    const v = await sentinel.get(P + 'before');
    console.log(`  t+${i + 1}s  GET -> ${v}  (still readable)`);
    recovered = true;
    break;
  } catch (e) {
    console.log(`  t+${i + 1}s  -> ${e.message}`);
  }
}
console.log('recovered within the loop?', recovered);

if (recovered) {
  console.log('SET after failover ->', await sentinel.set(P + 'after', 'written-on-new-primary'));
  console.log('GET after failover ->', await sentinel.get(P + 'after'));
  keys.push(P + 'after');
}

// ---------------------------------------------------------------------------
// 2. ⚠️ The replica that was promoted is now the primary; the old one must be
//    restarted as a replica of the NEW primary, or the cluster is split.
// ---------------------------------------------------------------------------
console.log('\n--- ⚠️ after failover ---');
console.log('  The promoted replica is now the primary.');
console.log('  The old primary must be restarted as a replica of the new one,');
console.log('  otherwise you have a split brain.');
console.log('  In production, Sentinel or your orchestrator does this for you.');

// Restart the old primary so the environment stays usable
execSync('docker start redis-learn');
await new Promise(r => setTimeout(r, 3000));

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------
const dbSize = await sentinel.dbSize().catch(() => '?');
console.log('\nDBSIZE after cleanup:', dbSize);
console.log('  (the old primary was restarted; the sentinel still points at the new primary)');
await si.close();
await sentinel.close();