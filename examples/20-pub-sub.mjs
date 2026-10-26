/**
 * Chapter 20 - Pub/Sub
 * Run:  node examples/20-pub-sub.mjs
 */
import { createClient } from 'redis';

const client = createClient({ url: 'redis://127.0.0.1:6379' });
await client.connect();

// ---------------------------------------------------------------------------
// 1. ⚠️ A subscriber needs its OWN connection
// ---------------------------------------------------------------------------
const sub = client.duplicate();
await sub.connect();

console.log('--- basics ---');
const received = [];
await sub.subscribe('news', (message, channel) => {
  received.push({ channel, message });
  console.log(`  [subscriber] ${channel}: ${message}`);
});

const n = await client.publish('news', 'hello world');
console.log('PUBLISH returned', n, '(= number of subscribers that received it)');
await new Promise(r => setTimeout(r, 150));

// ---------------------------------------------------------------------------
// 2. 🔴 Messages are NOT stored -- late subscribers miss everything
// ---------------------------------------------------------------------------
console.log('\n--- ⚠️ pub/sub is fire-and-forget ---');
// Publish to a channel NOBODY is subscribed to.
const got = await client.publish('no-one-is-listening', 'this vanishes instantly');
console.log("PUBLISH to an un-subscribed channel ->", got, '(0 subscribers = gone forever)');
console.log('  the early subscriber still has', received.length, 'message(s) from `news` only.');

console.log('\nnow a late subscriber joins and wants the backlog:');
const late = client.duplicate();
await late.connect();
let gotBacklog = 0;
await late.subscribe('news', () => { gotBacklog++; });
await new Promise(r => setTimeout(r, 120));
console.log('  messages the late subscriber received:', gotBacklog, '← ZERO, even though 1 was published earlier');
console.log('  ^ pub/sub has NO history. No replay, no offset, no acknowledgement.');
console.log('    If you need any of that, use STREAMS (chapter 14).');

// ---------------------------------------------------------------------------
// 3. Pattern subscriptions
// ---------------------------------------------------------------------------
console.log('\n--- psubscribe: wildcard channels ---');
const pat = [];
await sub.pSubscribe(['order.*', 'user.*'], (message, channel) => {
  pat.push(channel);
  console.log(`  [pattern] ${channel}: ${message}`);
});
await client.publish('order.created', 'order 123');
await client.publish('order.paid', 'order 123');
await client.publish('user.login', 'user 7');
await client.publish('news.ignored', 'should NOT match');
await new Promise(r => setTimeout(r, 150));
console.log('matched channels:', pat);
console.log('  ^ "news.ignored" did not match order.* or user.*');

// ---------------------------------------------------------------------------
// 4. Sharded Pub/Sub (Redis 7.0+)
// ---------------------------------------------------------------------------
console.log('\n--- sSubscribe: sharded pub/sub ---');
const shard = client.duplicate();
await shard.connect();
const shardMsgs = [];
await shard.sSubscribe('events', (msg) => shardMsgs.push(msg));
console.log('typeof sSubscribe ->', typeof shard.sSubscribe);
await new Promise(r => setTimeout(r, 80));
console.log('sharded pub/sub is available (Redis 7.0+)');

// ---------------------------------------------------------------------------
// 5. Unsubscribing and listing subscriptions
// ---------------------------------------------------------------------------
console.log('\n--- management ---');
// ⚠️ In node-redis 6 pSubscribe/pUnsubscribe return undefined. Older docs claim
//    they return the count of subscriptions -- verify with PUBSUB CHANNELS/NUMPAT.
await sub.pSubscribe('temp.*', () => {});
console.log('PUBSUB CHANNELS ->', await client.sendCommand(['PUBSUB', 'CHANNELS']), '(plain channels)');
console.log('PUBSUB NUMPAT   ->', await client.sendCommand(['PUBSUB', 'NUMPAT']), '(pattern subscriptions)');
await sub.pUnsubscribe();
console.log('PUBSUB NUMPAT after pUnsubscribe ->', await client.sendCommand(['PUBSUB', 'NUMPAT']));

console.log('\n--- introspection ---');
const info = await client.sendCommand(['PUBSUB', 'NUMSUB', 'news', 'order.created']);
console.log('PUBSUB NUMSUB news,order.created ->', info);
const shards = await client.sendCommand(['PUBSUB', 'SHARDNUMSUB']);
console.log('PUBSUB SHARDNUMSUB ->', shards);

// ---------------------------------------------------------------------------
// 6. 🔴 Pub/Sub + RESP2 sharding pitfall
// ---------------------------------------------------------------------------
console.log('\n--- ⚠️ why the subscriber connection matters ---');
console.log('  A subscribed connection cannot run normal commands.');
console.log('  node-redis handles this by putting the connection into subscriber mode.');
console.log('  That is why you must duplicate() rather than reuse the main client.');

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------
await sub.destroy();
await late.destroy();
await shard.destroy();
console.log('\nDBSIZE after cleanup:', await client.dbSize());
await client.close();