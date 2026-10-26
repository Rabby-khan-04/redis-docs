/**
 * Chapter 03 - Connect from Node.js
 * Run:  node examples/03-nodejs-client-setup.mjs
 *
 * Facts verified on Redis 8.10.2 + node-redis 6.3.0:
 *   - client.pipeline() no longer exists. Auto-pipelining replaced it.
 *   - client.quit() is deprecated; use close().
 *   - An unhandled 'error' event kills the process.
 */
import { createClient } from 'redis';

// ---------------------------------------------------------------------------
// 1. The correct way to create and connect a client.
// ---------------------------------------------------------------------------
// ⚠️ ALWAYS attach an 'error' handler. With no listener, an async socket error
//    becomes an unhandled 'error' event and Node kills the whole process.
const client = createClient({ url: 'redis://127.0.0.1:6379' });
client.on('error', (err) => console.log('  [error event]', err.message));
client.on('ready', () => console.log('  [ready event] connected and usable'));
client.on('end', () => console.log('  [end event] connection closed'));

await client.connect();
console.log('isReady:', client.isReady, '| isOpen:', client.isOpen);

// ---------------------------------------------------------------------------
// 2. Three ways to send the same command. They are equivalent.
// ---------------------------------------------------------------------------
await client.set('ch03:key', 'hello');

console.log('camelCase  ->', await client.get('ch03:key'));
console.log('RAW NAME   ->', await client.GET('ch03:key'));
console.log('sendCommand->', await client.sendCommand(['GET', 'ch03:key']));

// ---------------------------------------------------------------------------
// 3. A missing key returns null, NOT an error.
// ---------------------------------------------------------------------------
const missing = await client.get('ch03:does-not-exist');
console.log('missing key ->', missing, '| typeof', typeof missing, '| falsy?', !missing);

// ---------------------------------------------------------------------------
// 4. Auto-pipelining: no await, no explicit pipeline() call.
// ---------------------------------------------------------------------------
const N = 2000;

let t = process.hrtime.bigint();
const pending = [];
for (let i = 0; i < N; i++) pending.push(client.set(`ch03:auto:${i}`, i));
await Promise.all(pending);                     // you MUST collect the promises
let ms = Number(process.hrtime.bigint() - t) / 1e6;
console.log(`${N} auto-pipelined SETs: ${ms.toFixed(0)}ms (${Math.round(N / ms * 1000).toLocaleString()} ops/sec)`);

t = process.hrtime.bigint();
for (let i = 0; i < 200; i++) await client.set(`ch03:seq:${i}`, i);   // one round trip each
ms = Number(process.hrtime.bigint() - t) / 1e6;
console.log(`200 sequential SETs   : ${ms.toFixed(0)}ms (${Math.round(200 / ms * 1000).toLocaleString()} ops/sec)`);

// ---------------------------------------------------------------------------
// 5. Connection options.
// ---------------------------------------------------------------------------
console.log('default db  :', client._self ? '(internal)' : '');
// The URL format is: redis[s]://[[username][:password]@][host][:port][/db]
const withDb = createClient({ url: 'redis://127.0.0.1:6379/2' });
await withDb.connect();
await withDb.set('ch03:db2', 'in database 2');
console.log('wrote/ read in db 2:', await withDb.get('ch03:db2'));
await withDb.del('ch03:db2');
await withDb.close();

// ---------------------------------------------------------------------------
// 6. close() is the right way to shut down. quit() is deprecated.
// ---------------------------------------------------------------------------
const c2 = createClient({ url: 'redis://127.0.0.1:6379' });
const events = [];
c2.on('ready', () => events.push('ready'));
c2.on('end', () => events.push('end'));
await c2.connect();
await c2.close();
console.log('open+close events:', events.join(' -> '));
console.log('after close(): isOpen =', c2.isOpen, '| isReady =', c2.isReady);

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------
await client.del([
  'ch03:key',
  ...Array.from({ length: N }, (_, i) => `ch03:auto:${i}`),
  ...Array.from({ length: 200 }, (_, i) => `ch03:seq:${i}`),
]);
await client.close();