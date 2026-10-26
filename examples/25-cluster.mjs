/**
 * Chapter 25 - Cluster
 * Run:  node examples/25-cluster.mjs
 *
 * Infra: 3 master nodes (redis-c0, redis-c1, redis-c2) on 172.17.0.3/4/5:6379.
 */
import { createCluster } from 'redis';

const cluster = createCluster({
  rootNodes: [
    { url: 'redis://172.17.0.3:6379' },
    { url: 'redis://172.17.0.4:6379' },
    { url: 'redis://172.17.0.5:6379' },
  ],
});
await cluster.connect();

const P = 'ch25:';

console.log('--- basics ---');
console.log('isReady ->', cluster.isReady);
await cluster.set(P + 'k1', 'v1');
console.log('GET k1 ->', await cluster.get(P + 'k1'));
console.log('CLUSTER KEYSLOT ->', await cluster.clusterKeySlot(P + 'k1'));

// ---------------------------------------------------------------------------
// 1. ⭐ Hash tags force keys onto the same node
// ---------------------------------------------------------------------------
console.log('\n--- hash tags ---');
await cluster.set(`{user}:1:name`, 'Ada');
await cluster.set(`{user}:1:age`, '36');
console.log('GET {user}:1:name ->', await cluster.get(`{user}:1:name`));
console.log('GET {user}:1:age  ->', await cluster.get(`{user}:1:age`));
console.log('  ^ the {user} tag puts both keys in the SAME slot, so multi-key ops work');

// ---------------------------------------------------------------------------
// 2. ⚠️ Cross-slot operations fail
// ---------------------------------------------------------------------------
console.log('\n--- cross-slot operations ---');
try {
  await cluster.mGet([P + 'k1', `{user}:1:name`]);
  console.log('cross-slot MGET -> succeeded (client routed per-key)');
} catch (e) {
  console.log('cross-slot MGET ->', e.message);
}

try {
  await cluster.multi().get(P + 'k1').get(`{user}:1:name`).exec();
} catch (e) {
  console.log('cross-slot MULTI ->', e.message, '(MULTI cannot span slots)');
}

// ---------------------------------------------------------------------------
// 3. MOVED / ASK redirects (handled automatically by the client)
// ---------------------------------------------------------------------------
console.log('\n--- redirects ---');
console.log('  The client handles MOVED and ASK redirects transparently.');
console.log('  You never see them unless you bypass the client with raw sendCommand.');

// ---------------------------------------------------------------------------
// 4. Cluster info (raw string, parsed here)
// ---------------------------------------------------------------------------
console.log('\n--- cluster info ---');
const infoRaw = await cluster.clusterInfo();
const info = Object.fromEntries(
  infoRaw.trim().split(/\r?\n/).map(l => l.split(':')).map(([k, v]) => [k.trim(), (v||'').trim()]));
console.log('cluster_state          :', info.cluster_state);
console.log('cluster_slots_assigned :', info.cluster_slots_assigned);
console.log('cluster_known_nodes    :', info.cluster_known_nodes);
console.log('cluster_size           :', info.cluster_size);
console.log('cluster_current_epoch  :', info.cluster_current_epoch);

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------
const scan = async (pat) => {
  const f = []; let cur = '0';
  // cluster has no global SCAN; scan via a single node is fine for cleanup
  const r = await cluster.scan(cur, { MATCH: pat, COUNT: 1000 });
  // cluster.scan returns the same shape
  return r.keys;
};
const found = await scan(`${P}*`);
if (found.length) await cluster.del(found);
await cluster.del([P + 'k1', '{user}:1:name', '{user}:1:age']);
console.log('\ncluster DBSIZE-ish (per-node):', await cluster.dbSize());
await cluster.close();