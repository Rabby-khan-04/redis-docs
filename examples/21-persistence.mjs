/**
 * Chapter 21 - Persistence (RDB and AOF)
 * Run:  node examples/21-persistence.mjs
 */
import { createClient } from 'redis';

const client = createClient({ url: 'redis://127.0.0.1:6379' });
await client.connect();

const P = 'ch21:';
const keys = [];

// ---------------------------------------------------------------------------
// 1. What is on by default? RDB: yes. AOF: no.
// ---------------------------------------------------------------------------
console.log('--- what is on? ---');
const cfg = await client.configGet('appendonly');
console.log('appendonly (AOF) ->', cfg.appendonly, '  (no = RDB-only on this server)');
const save = await client.configGet('save');
console.log('save (RDB triggers) ->', save.save);
console.log('  -> 3600 1 300 100 60 10000 means:');
console.log('     after 3600s if 1 change, OR 300s if 100 changes, OR 60s if 10000 changes');

const info = await client.info('persistence');
console.log('\nkey persistence stats:');
for (const line of info.split('\n')) {
  if (/^(aof_enabled|rdb_last_bgsave_status|rdb_last_save_time|rdb_changes_since_last_save|aof_rewrite_in_progress)/.test(line)) {
    console.log('  ' + line);
  }
}

// ---------------------------------------------------------------------------
// 2. Manually trigger a save
// ---------------------------------------------------------------------------
console.log('\n--- manual save ---');
await client.set(P + 'x', 'hello'); keys.push(P + 'x');
console.log('BGSAVE ->', await client.bgSave());
await new Promise(r => setTimeout(r, 600));
const info2 = await client.info('persistence');
console.log('rdb_last_bgsave_status ->', info2.split('\n').find(l => l.startsWith('rdb_last_bgsave_status')));
console.log('rdb_last_save_time    ->', info2.split('\n').find(l => l.startsWith('rdb_last_save_time')));
console.log('LASTSAVE ->', await client.lastSave());

// ---------------------------------------------------------------------------
// 3. AOF: turn it on at runtime (does NOT survive a restart unless CONFIG REWRITE)
// ---------------------------------------------------------------------------
console.log('\n--- AOF ---');
console.log('CONFIG SET appendonly yes ->', await client.configSet('appendonly', 'yes'));
console.log('aof_enabled now ->', (await client.info('persistence')).split('\n').find(l => l.startsWith('aof_enabled')));
// disable again for cleanliness
await client.configSet('appendonly', 'no');
console.log('restored appendonly=no');

// ---------------------------------------------------------------------------
// 4. ⚠️ CONFIG SET is runtime-only; CONFIG REWRITE makes it persistent
// ---------------------------------------------------------------------------
console.log('\n--- config persistence ---');
console.log('CONFIG SET changes the running server only.');
console.log('CONFIG REWRITE writes it to the config file (if one exists).');
console.log('In a Docker container with no config file, REWRITE has nowhere to go.');
console.log('Real config belongs in a mounted redis.conf or env vars.');

// ---------------------------------------------------------------------------
// 5. Forking and COW (copy-on-write)
// ---------------------------------------------------------------------------
console.log('\n--- fork / COW ---');
console.log('BGSAVE forks a child process. The child writes the RDB while the parent keeps running.');
console.log('The fork uses copy-on-write: memory is shared until a page changes.');
console.log('A big write load during a save can double memory briefly (current_cow_peak).');
const info3 = await client.info('persistence');
console.log('current_cow_peak ->', info3.split('\n').find(l => l.startsWith('current_cow_peak')));

// ---------------------------------------------------------------------------
// 6. AOF rewrite
// ---------------------------------------------------------------------------
console.log('\n--- AOF rewrite ---');
console.log('BGREWRITEAOF ->', await client.bgRewriteAof());
await new Promise(r => setTimeout(r, 600));
const info4 = await client.info('persistence');
console.log('aof_last_bgrewrite_status ->', info4.split('\n').find(l => l.startsWith('aof_last_bgrewrite_status')));
console.log('aof_rewrite_in_progress  ->', info4.split('\n').find(l => l.startsWith('aof_rewrite_in_progress')));

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------
await client.del(keys);
console.log('\nDBSIZE after cleanup:', await client.dbSize());
await client.close();