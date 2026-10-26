/**
 * Chapter 23 - Replication
 * Run:  node examples/23-replication.mjs
 */
import { createClient } from 'redis';

const primary = createClient({ url: 'redis://127.0.0.1:6379' });
await primary.connect();

// The replica is on port 6381 (mapped to host) -- use the host mapping.
const replica = createClient({ url: 'redis://127.0.0.1:6381' });
await replica.connect();

const P = 'ch23:';
const keys = [];

console.log('--- roles ---');
const priInfo = await primary.info('replication');
const repInfo = await replica.info('replication');
console.log('primary role  ->', priInfo.match(/role:(\S+)/)[1]);
console.log('replica role  ->', repInfo.match(/role:(\S+)/)[1]);
console.log('primary connected_slaves ->', priInfo.match(/connected_slaves:(\S+)/)[1]);
console.log('replica master_host     ->', repInfo.match(/master_host:(\S+)/)[1]);
console.log('replica master_link_status ->', repInfo.match(/master_link_status:(\S+)/)[1]);

// ---------------------------------------------------------------------------
// 1. Write on primary, read on replica
// ---------------------------------------------------------------------------
console.log('\n--- write -> replicate ---');
await primary.set(P + 'msg', 'hello from primary'); keys.push(P + 'msg');
console.log('primary SET ->', await primary.get(P + 'msg'));

// Replication is async; give it a moment
await new Promise(r => setTimeout(r, 200));
console.log('replica GET ->', await replica.get(P + 'msg'), '  (replicated)');

// ---------------------------------------------------------------------------
// 2. ⚠️ Replica is read-only by default
// ---------------------------------------------------------------------------
console.log('\n--- replica rejects writes ---');
try {
  await replica.set(P + 'x', 'no');
} catch (e) {
  console.log('replica SET ->', e.message);
  console.log('  ^ READONLY You can\'t write against a read only replica.');
}
console.log('replica_read_only config ->',
  (await replica.configGet('replica-read-only'))['replica-read-only']);

// ---------------------------------------------------------------------------
// 3. Replication lag
// ---------------------------------------------------------------------------
console.log('\n--- replication lag ---');
const before = await primary.info('replication');
console.log('primary master_repl_offset ->', before.match(/master_repl_offset:(\d+)/)[1]);
// write a bunch
for (let i = 0; i < 1000; i++) await primary.set(`${P}bulk:${i}`, i);
console.log('wrote 1000 keys on primary');
await new Promise(r => setTimeout(r, 500));
const after = await replica.info('replication');
console.log('replica master_repl_offset ->', after.match(/master_repl_offset:(\d+)/)[1]);
console.log('replica slave_repl_offset  ->', after.match(/slave_repl_offset:(\d+)/)[1]);
console.log('  ^ the two offsets match when the replica is caught up');

// ---------------------------------------------------------------------------
// 4. REPLICAOF / REPLICAOF NO ONE -- promotion
// ---------------------------------------------------------------------------
console.log('\n--- promotion ---');
console.log('REPLICAOF NO ONE turns a replica into a primary (manual failover)');
// (we leave it as-is to not break the cluster)

// ---------------------------------------------------------------------------
// 5. ⚠️ Async replication = data loss on primary crash
// ---------------------------------------------------------------------------
console.log('\n--- ⚠️ async replication and data loss ---');
console.log('Replication is ASYNCHRONOUS: a write returns OK before the replica has it.');
console.log('If the primary crashes in that window, the write is LOST.');
console.log('WAIT key numreplicas timeout  -- blocks until N replicas have the write');

await primary.set(P + 'waited', 'important');
const waitRet = await primary.sendCommand(['WAIT', '1', '1000']);
console.log('WAIT 1 1000 ->', waitRet, '(1 = replica has it, 0 = timed out)');

// ---------------------------------------------------------------------------
// 6. Partial resync (PSYNC)
// ---------------------------------------------------------------------------
console.log('\n--- PSYNC (partial resync) ---');
console.log('On reconnect, the replica asks the primary: "do you still have my backlog?"');
console.log('  if yes -> partial resync (fast, no full snapshot)');
console.log('  if no  -> full resync (slow, dumps the whole DB)');
console.log('The backlog size is `repl-backlog-size` (default 1 MB).');
console.log('repl_backlog_size ->', (await primary.configGet('repl-backlog-size'))['repl-backlog-size']);

// ---------------------------------------------------------------------------
// 7. Read scaling: replica is read-only by default
// ---------------------------------------------------------------------------
console.log('\n--- read scaling ---');
await new Promise(r => setTimeout(r, 300));
const v = await replica.get(P + 'msg');
console.log('replica GET ->', v, '  (you can read from replicas to scale reads)');
console.log('  ^ but replication is async, so a read might be stale by a few ms');

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------
const scan = async (c, pat) => {
  const f = []; let cur = '0';
  do { const r = await c.scan(cur, { MATCH: pat, COUNT: 1000 }); cur = r.cursor; f.push(...r.keys); } while (cur !== '0');
  return f;
};
const pk = await scan(primary, `${P}*`);
if (pk.length) await primary.del(pk);
console.log('\nDBSIZE primary after cleanup:', await primary.dbSize());
await primary.close();
await replica.close();