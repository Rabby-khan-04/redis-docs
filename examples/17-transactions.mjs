/**
 * Chapter 17 - Transactions (MULTI/EXEC)
 * Run:  node examples/17-transactions.mjs
 */
import { createClient } from 'redis';

const client = createClient({ url: 'redis://127.0.0.1:6379' });
const other = client.duplicate();
await client.connect(); await other.connect();

const P = 'ch17:';
const keys = [];

// ---------------------------------------------------------------------------
// 1. MULTI/EXEC: commands are queued, then run with nothing in between
// ---------------------------------------------------------------------------
console.log('--- basics ---');
await client.set(P + 'a', '1');
await client.set(P + 'b', '2');
keys.push(P + 'a', P + 'b');

const res = await client.multi()
  .set(P + 'a', '10')
  .incr(P + 'counter')
  .get(P + 'b')
  .exec();
console.log('multi replies ->', res);
console.log('  ^ the array is POSITIONAL: [SET reply, INCR reply, GET reply]');

// ---------------------------------------------------------------------------
// 2. ⭐ No rollback: a failing command does NOT undo the others
// ---------------------------------------------------------------------------
console.log('\n--- ⚠️ there is NO rollback ---');
await client.set(P + 'good', 'i am a string'); keys.push(P + 'good');
try {
  await client.multi()
    .set(P + 'first', 'this WILL be written')
    .lPush(P + 'good', ['x'])      // ✗ WRONGTYPE
    .incr(P + 'good')              // ✗ not an integer
    .exec();
  console.log('no error thrown (unexpected)');
} catch (e) {
  console.log('threw ->', e.constructor.name);
  console.log('  message:', e.message);
  console.log('  replies        :', e.replies.map(r => r && r.message ? r.message : r));
  console.log('  errorIndexes   :', e.errorIndexes);
}
console.log('  ^ index 0 succeeded, 1 and 2 failed. BOTH happened. Nothing was undone.');
console.log('  first  =', await client.get(P + 'first'));
console.log('  good   =', await client.get(P + 'good'), '(unchanged)');
keys.push(P + 'first');

// ---------------------------------------------------------------------------
// 3. Checking replies
// ---------------------------------------------------------------------------
// Under RESP3 a SUCCESSFUL reply is just the raw value ('OK', 1, '2').
// If ANY command fails, exec() THROWS MultiErrorReply carrying .replies and
// .errorIndexes. So: try/catch, then check the value is not null.
console.log('\n--- safe transfer ---');
async function safeTransfer(from, to, amount) {
  try {
    const [debit, credit] = await client.multi()
      .incrBy(from, -amount)
      .incrBy(to, amount)
      .exec();
    if (debit !== null && credit !== null) return { ok: true, debit, credit };
    return { ok: false, note: 'null reply' };
  } catch (e) {
    return { ok: false, errors: e.replies.map(r => r && r.message ? r.message : r) };
  }
}

await client.set(P + 'alice', '100');
await client.set(P + 'bob', '0');
keys.push(P + 'alice', P + 'bob', P + 'counter');
console.log('transfer 30:', await safeTransfer(P + 'alice', P + 'bob', 30));
console.log('alice =', await client.get(P + 'alice'), ' bob =', await client.get(P + 'bob'));

// what if a key is missing? INCRBY on a missing key CREATES it at -amount
await client.del(P + 'ghost');
const bad = await client.multi().incrBy(P + 'ghost', -30).incrBy(P + 'bob', 30).exec();
console.log('\n⚠️ INCRBY on a MISSING key creates it at the offset value:');
console.log('  replies ->', bad);
console.log('  ghost is now', await client.get(P + 'ghost'), '← a -30 balance was invented!');
keys.push(P + 'ghost');

// ---------------------------------------------------------------------------
// 4. 🔴 WATCH: optimistic locking
// ---------------------------------------------------------------------------
console.log('\n--- WATCH: optimistic locking ---');
await client.set(P + 'acct', '100'); keys.push(P + 'acct');

async function withdraw(key, amount) {
  await client.watch(key);                       // top-level command in node-redis 6
  const balance = Number(await client.get(key));
  if (balance < amount) {
    await client.unwatch();
    return { ok: false, reason: `insufficient funds (balance ${balance})` };
  }
  try {
    const replies = await client.multi()
      .set(key, balance - amount)
      .exec();
    return { ok: replies[0] !== null, reason: 'withdrew ' + amount };
  } catch (e) {
    return { ok: false, reason: e.constructor.name };   // someone else changed the key
  }
}

console.log('withdraw 30 ->', await withdraw(P + 'acct', 30));
console.log('acct is now', await client.get(P + 'acct'));

// Now simulate a race: watch, then another client modifies the key.
console.log('\n--- WATCH detects interference ---');
await client.set(P + 'race', '100');
await client.watch(P + 'race');
await other.set(P + 'race', '999');              // another client sneaks in
try {
  await client.multi().set(P + 'race', '0').exec();
  console.log('exec succeeded (BAD -- should have aborted)');
} catch (e) {
  console.log('exec threw ->', e.constructor.name + ':', e.message);
}
console.log('value is', await client.get(P + 'race'), '(the other client won)');
keys.push(P + 'race');

// ---------------------------------------------------------------------------
// 5. ⚠️ WATCH requires a dedicated connection
// ---------------------------------------------------------------------------
console.log('\n--- WATCH needs its own connection ---');
const dedicated = client.duplicate();
await dedicated.connect();
await dedicated.set(P + 'own', '1'); keys.push(P + 'own');
await dedicated.watch(P + 'own');
console.log('dedicated connection can watch without deadlocking ✓');
const dres = await dedicated.multi().set(P + 'own', '2').exec();
console.log('its own transaction works ->', dres[0]);
await dedicated.unwatch();
await dedicated.close();

// ---------------------------------------------------------------------------
// 6. ⭐ The safe pattern: do the check INSIDE the transaction with Lua
// ---------------------------------------------------------------------------
console.log('\n--- ⭐ atomic conditional update (Lua) ---');
await client.set(P + 'stock', '1'); keys.push(P + 'stock');

// The WRONG way: check then set in JS (race between the two).
await client.del(P + 'winner');
const claimed = await client.eval(`
  if redis.call('GET', KEYS[1]) == '1' then
    redis.call('SET', KEYS[1], '0')
    return 1
  end
  return 0
`, { keys: [P + 'stock'], arguments: [] });
console.log('first claim  ->', claimed);
const second = await client.eval(`
  if redis.call('GET', KEYS[1]) == '1' then
    redis.call('SET', KEYS[1], '0')
    return 1
  end
  return 0
`, { keys: [P + 'stock'], arguments: [] });
console.log('second claim ->', second, '(0 = already claimed, no race possible)');
console.log('  ^ only ONE of these can ever succeed, no matter how many callers');

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------
await client.del(keys);
console.log('\nDBSIZE after cleanup:', await client.dbSize());
await client.close(); await other.close();