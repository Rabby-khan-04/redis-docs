/**
 * Chapter 01 - What is Redis?
 * Run:  node examples/01-what-is-redis.mjs
 */
import { createClient } from 'redis';

const client = createClient({ url: 'redis://127.0.0.1:6379' });
await client.connect();

// --- 1. The simplest possible thing: store a value under a name -------------
await client.set('greeting', 'hello');
console.log('GET greeting ->', await client.get('greeting'));

// --- 2. ...and it is very fast. Let's prove it with 10,000 round trips. ----
const N = 10_000;
let t = process.hrtime.bigint();

for (let i = 0; i < N; i++) {
  // We await every single command one at a time, the slow way.
  await client.set(`ch01:${i}`, i);
}
let ms = Number(process.hrtime.bigint() - t) / 1e6;
console.log(`${N} sequential SETs  : ${ms.toFixed(0)}ms  (${Math.round(N / ms * 1000).toLocaleString()} ops/sec)`);

// Same work, but all requests are written in one go (a "pipeline").
t = process.hrtime.bigint();
for (let i = 0; i < N; i++) client.set(`ch01:${i}`, i);   // no await
await client.ping();                                       // this waits for them
ms = Number(process.hrtime.bigint() - t) / 1e6;
console.log(`${N} SETs pipelined  : ${ms.toFixed(0)}ms  (${Math.round(N / ms * 1000).toLocaleString()} ops/sec)`);

// --- 3. It keeps data in RAM. Watch the memory number go up. -------------
const before = await client.info('memory');
const beforeMb = before.match(/used_memory_human:(\S+)/)[1];

for (let i = 0; i < 50_000; i++) await client.set(`ch01:big:${i}`, 'x'.repeat(200));

const after = await client.info('memory');
const afterMb = after.match(/used_memory_human:(\S+)/)[1];
console.log(`memory before: ${beforeMb}  ->  after 50k keys: ${afterMb}`);

// --- 4. It is single-threaded: one slow command blocks everybody. ----------
const probe = client.duplicate();
await probe.connect();
await client.set('ch01:ping', 'pong');

const samples = [];
const ticker = setInterval(async () => {
  const s = process.hrtime.bigint();
  await probe.get('ch01:ping');
  samples.push(Number(process.hrtime.bigint() - s) / 1e6);
}, 10);

const t0 = process.hrtime.bigint();
await client.eval('for i=1,4000000 do local x=i*i end return 1', { keys: [], arguments: [] });
const slowMs = Number(process.hrtime.bigint() - t0) / 1e6;
await new Promise(r => setTimeout(r, 300));
clearInterval(ticker);
console.log(`one slow command took ${slowMs.toFixed(0)}ms; an unrelated GET took up to ${Math.max(...samples).toFixed(1)}ms`);

// --- 5. What is the server actually? ---------------------------------------
const info = await client.info('server');
for (const line of info.split('\n')) {
  if (/^(redis_version|redis_mode|os|arch_bits|multiplexing_api|tcp_port|uptime_in_days)/.test(line)) {
    console.log('  ' + line);
  }
}

await client.del([...Array.from({ length: N }, (_, i) => `ch01:${i}`),
                  ...Array.from({ length: 50_000 }, (_, i) => `ch01:big:${i}`),
                  'ch01:ping', 'greeting']);
await probe.close();
await client.close();      // close(), NOT quit() -- quit is deprecated