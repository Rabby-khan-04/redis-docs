/**
 * Chapter 14 - Streams
 * Run:  node examples/14-streams.mjs
 */
import { createClient } from 'redis';

const client = createClient({ url: 'redis://127.0.0.1:6379' });
await client.connect();

const P = 'ch14:';
const S = P + 'events';
const keys = [S];

// ---------------------------------------------------------------------------
// 1. A stream is an append-only log with generated IDs
// ---------------------------------------------------------------------------
console.log('--- basics ---');
const id1 = await client.xAdd(S, '*', { action: 'login', user: '1' });
const id2 = await client.xAdd(S, '*', { action: 'view', user: '1' });
console.log('XADD ->', id1);
console.log('XADD ->', id2, '   (IDs are time-based: <milliseconds>-<sequence>)');
console.log('XLEN ->', await client.xLen(S));

const entries = await client.xRange(S, '-', '+');
console.log('XRANGE ->');
for (const e of entries) console.log('  ', e.id, JSON.stringify(e.message));

console.log('TYPE ->', await client.type(S), '  (a stream is its own type, not a list)');

// ---------------------------------------------------------------------------
// 2. Reading: XREAD with an ID
// ---------------------------------------------------------------------------
console.log('\n--- XREAD ---');
console.log('XREAD from 0 ->');
for (const s of await client.xRead({ key: S, id: '0' }, { COUNT: 10 })) {
  console.log('  stream:', s.name);
  for (const m of s.messages) console.log('   ', m.id, JSON.stringify(m.message));
}
console.log('XREAD from $ (only NEW entries) ->',
  JSON.stringify(await client.xRead({ key: S, id: '$' }, { COUNT: 10 })));
console.log('  ^ "$" means "from now on", which is what live tailing uses');

// ---------------------------------------------------------------------------
// 3. ⚠️ Consumer groups: the reason Streams exist
// ---------------------------------------------------------------------------
console.log('\n--- consumer groups ---');
await client.xGroupCreate(S, 'workers', '0', { MKSTREAM: true });
await client.xGroupCreateConsumer(S, 'workers', 'worker-1');

const group = await client.xGroupCreateConsumer(S, 'workers', 'worker-2');
console.log('XGROUP CREATE workers 0 MKSTREAM -> ok');
console.log('XGROUP CREATECONSUMER worker-2 ->', group, '(1 = created)');

const mine = await client.xReadGroup('workers', 'worker-1', { key: S, id: '>' }, { COUNT: 10 });
console.log('\nXREADGROUP worker-1 (> = never delivered before):');
for (const s of mine) for (const m of s.messages) console.log('   ', m.id, JSON.stringify(m.message));

const theirs = await client.xReadGroup('workers', 'worker-2', { key: S, id: '>' }, { COUNT: 10 });
console.log('XREADGROUP worker-2 ->', JSON.stringify(theirs), '  (nothing: worker-1 owns them)');

// ---------------------------------------------------------------------------
// 4. Pending entries and XACK
// ---------------------------------------------------------------------------
console.log('\n--- ack ---');
const pendBefore = await client.sendCommand(['XPENDING', S, 'workers']);
console.log('XPENDING summary ->', pendBefore[0], 'entries pending');
console.log('  ^ entries are delivered but NOT acknowledged = a worker may have crashed');

const firstId = mine[0].messages[0].id;
console.log('XACK', firstId, '->', await client.xAck(S, 'workers', firstId));
const pendAfter = await client.sendCommand(['XPENDING', S, 'workers']);
console.log('XPENDING after ack ->', pendAfter[0], 'entries pending');

// Detail view of pending entries
const detail = await client.sendCommand(['XPENDING', S, 'workers', '-', '+', '10']);
console.log('XPENDING detail ->', JSON.stringify(detail));

// ---------------------------------------------------------------------------
// 5. ⭐ XAUTOCLAIM: recovering work from a dead consumer
// ---------------------------------------------------------------------------
console.log('\n--- XAUTOCLAIM (rescue abandoned work) ---');
// worker-1 got entries but never acked them. A new worker can steal them after a timeout.
await new Promise(r => setTimeout(r, 1100));          // pretend 1 second of "work time"
const claimed = await client.sendCommand(
  ['XAUTOCLAIM', S, 'workers', 'worker-3', '1000', '0', 'COUNT', '10']);
console.log('XAUTOCLAIM ->', JSON.stringify(claimed));
console.log('  ^ next-cursor and the entries claimed from the dead consumer');

// Read the group's state
const info = await client.xInfoGroups(S);
const g = info[0];
console.log('\nXINFO GROUPS ->', {
  name: g.name, consumers: g.consumers, pending: g.pending,
  'last-delivered-id': g['last-delivered-id'], lag: g.lag,
  'entries-read': g['entries-read'],
});
console.log('  ^ note the HYPHENATED field names under RESP3, not camelCase');

// ---------------------------------------------------------------------------
// 6. Trimming: streams grow forever otherwise
// ---------------------------------------------------------------------------
console.log('\n--- trimming ---');
console.log('XLEN before trim ->', await client.xLen(S));
await client.xTrim(S, 'MAXLEN', 1);
console.log('XLEN after XTRIM MAXLEN 1 ->', await client.xLen(S));

await client.del(S);

for (let i = 0; i < 500; i++) await client.xAdd(S, '*', { n: String(i) });
console.log('added 500 -> XLEN', await client.xLen(S));
await client.xAdd(S, '*', { n: 'newest' }, { TRIM: { strategy: 'MAXLEN', threshold: 100, LIMIT: 20 } });
console.log('after XADD with TRIM MAXLEN 100 ->', await client.xLen(S));
console.log('  ^ trimming happens during XADD: fewer commands, no extra latency spike');

// ---------------------------------------------------------------------------
// 7. Streams vs Lists for a queue
// ---------------------------------------------------------------------------
console.log('\n--- lists vs streams for queues ---');
console.log('  LIST   : LPOP removes it. Crash = job lost. No ack. No fan-out.');
console.log('  STREAM : XREADGROUP delivers it. XPENDING tracks it. XACK confirms.');
console.log('           XAUTOCLAIM hands abandoned work to another consumer.');
console.log('           Multiple groups each see EVERY entry (fan-out).');

if (keys.length) await client.del(keys);
console.log('\nDBSIZE after cleanup:', await client.dbSize());
await client.close();