/**
 * Chapter 19 - Lua scripting
 * Run:  node examples/19-lua-scripting.mjs
 */
import { createClient } from 'redis';

const client = createClient({ url: 'redis://127.0.0.1:6379' });
await client.connect();

const P = 'ch19:';
const keys = [];

// ---------------------------------------------------------------------------
// 1. A basic script: KEYS = keys, ARGV = arguments
// ---------------------------------------------------------------------------
console.log('--- basics ---');
const basic = await client.eval(`
  local sum = 0
  for i, key in ipairs(KEYS) do
    local v = redis.call('GET', key)
    if v then sum = sum + tonumber(v) end
  end
  return sum
`, { keys: [], arguments: [] });
console.log('empty script ->', basic);

await client.set(P + 'n1', '10');
await client.set(P + 'n2', '20');
await client.set(P + 'n3', '5');
keys.push(P + 'n1', P + 'n2', P + 'n3');

const total = await client.eval(`
  local sum = 0
  for i, key in ipairs(KEYS) do
    local v = redis.call('GET', key)
    if v then sum = sum + tonumber(v) end
  end
  return sum
`, { keys: [P + 'n1', P + 'n2', P + 'n3'], arguments: [] });
console.log('sum of 3 keys ->', total, '(a single atomic round trip)');

// ---------------------------------------------------------------------------
// 2. 🔴 The rules: KEYS must be passed in, never hardcoded
// ---------------------------------------------------------------------------
console.log('\n--- ⚠️ KEYS and ARGV rules ---');
console.log('  KEYS[1..n]  the key names, passed by the caller');
console.log('  ARGV[1..n]  the arguments, passed by the caller');
console.log('  ✗ NEVER hardcode a key inside the script.');
console.log('    In Redis Cluster (and with key-tracking rewrites) that breaks.');
const usesArgv = await client.eval(
  'return redis.call("GET", KEYS[1]) .. ":" .. ARGV[1]', { keys: [P + 'n1'], arguments: ['suffix'] });
console.log('demo ->', usesArgv);

// ---------------------------------------------------------------------------
// 3. ⭐ The real payoff: atomic check-and-act
// ---------------------------------------------------------------------------
console.log('\n--- ⭐ atomic conditional update ---');
await client.set(P + 'stock', '1'); keys.push(P + 'stock');

const CLAIM = `
  local stock = tonumber(redis.call('GET', KEYS[1]) or '0')
  if stock <= 0 then return 0 end
  redis.call('DECRBY', KEYS[1], tonumber(ARGV[1]))
  return 1
`;

const results = await Promise.all(
  Array.from({ length: 50 }, () =>
    client.eval(CLAIM, { keys: [P + 'stock'], arguments: ['1'] }))
);
const wins = results.filter(r => r === 1).length;
console.log(`50 concurrent claims on stock=1 -> ${wins} succeeded, ${results.length - wins} refused`);
console.log('  ^ EXACTLY ONE wins. Impossible with GET-then-SET in JS.');
console.log('  stock is now', await client.get(P + 'stock'));

// ---------------------------------------------------------------------------
// 4. Rate limiter: fixed window, atomic
// ---------------------------------------------------------------------------
console.log('\n--- rate limiter in Lua ---');
const RATE = `
  local current = redis.call('INCR', KEYS[1])
  if current == 1 then
    redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
  end
  return current
`;

await client.del(P + 'rate:user1');
const counts = [];
for (let i = 0; i < 7; i++) {
  counts.push(await client.eval(RATE, { keys: [P + 'rate:user1'], arguments: ['10'] }));
}
console.log('7 calls in one 10s window ->', counts);
console.log('allowed (count <= 3):', counts.filter(c => c <= 3).length);
console.log('TTL is', await client.ttl(P + 'rate:user1'), 'seconds');
console.log('  ^ the INCR and the EXPIRE are atomic, so the key can never leak forever.');
keys.push(P + 'rate:user1');

// ---------------------------------------------------------------------------
// 5. 🔴 Scripts BLOCK the server
// ---------------------------------------------------------------------------
console.log('\n--- ⚠️ scripts block the server ---');
const probe = client.duplicate();
await probe.connect();
await client.set(P + 'ping', 'pong'); keys.push(P + 'ping');

const samples = [];
const ticker = setInterval(async () => {
  const t0 = process.hrtime.bigint();
  await probe.get(P + 'ping');
  samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
}, 5);

const t0 = process.hrtime.bigint();
await client.eval('for i=1,3000000 do local x = i*i end return 1',
                  { keys: [], arguments: [] });
const blockedMs = Number(process.hrtime.bigint() - t0) / 1e6;
await new Promise(r => setTimeout(r, 500));
clearInterval(ticker);
samples.sort((a, b) => a - b);
console.log(`one slow script ran for ${blockedMs.toFixed(0)}ms`);
console.log(`unrelated GET during it: p50=${samples[Math.floor(samples.length / 2)].toFixed(2)}ms max=${samples[samples.length - 1].toFixed(2)}ms`);
console.log('  ^ NOTHING else runs. Keep scripts tiny.');

// ---------------------------------------------------------------------------
// 6. SCRIPT LOAD / EVALSHA -- caching
// ---------------------------------------------------------------------------
console.log('\n--- SCRIPT LOAD + EVALSHA ---');
const sha = await client.scriptLoad(CLAIM);
console.log('SCRIPT LOAD ->', sha.slice(0, 16) + '...');
console.log('EVALSHA     ->', await client.evalSha(sha, { keys: [P + 'stock'], arguments: ['0'] }));

console.log('\n⚠️ node-redis 6 has NO defineScript() helper (it was removed).');
console.log('  Use eval() / evalSha() / scriptLoad() directly and handle NOSCRIPT yourself:');

let cachedSha = await client.scriptLoad(CLAIM);
console.log('  SCRIPT LOAD ->', cachedSha.slice(0, 16) + '...');

async function callClaim(keys, args) {
  try {
    return await client.evalSha(cachedSha, { keys, arguments: args });
  } catch (e) {
    if (e.message.includes('NOSCRIPT')) {
      cachedSha = await client.scriptLoad(CLAIM);           // reload once
      return await client.evalSha(cachedSha, { keys, arguments: args });
    }
    throw e;
  }
}

await client.set(P + 'stock', '2'); keys.push(P + 'stock');
console.log('  EVALSHA claim ->', await callClaim([P + 'stock'], ['1']));
console.log('  EVALSHA claim ->', await callClaim([P + 'stock'], ['1']));

console.log('\nNOSCRIPT after a SCRIPT FLUSH:');
await client.scriptFlush();
console.log('  EVALSHA now  ->', await callClaim([P + 'stock'], ['1']));
console.log('  ^ the catch block reloaded the script transparently. Without it you would');
console.log('    get: NOSCRIPT No matching script.');

// ---------------------------------------------------------------------------
// 7. Replica reads: IS_READ_ONLY variants
// ---------------------------------------------------------------------------
console.log('\n--- EVALSHA_RO (read-only, can run on replicas) ---');
console.log('  Script config supports IS_READ_ONLY -> sends EVALSHA_RO instead of EVALSHA');
console.log('  (only reachable via the low-level `scripts:` option in v6)');

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------
await client.del(keys);
console.log('\nDBSIZE after cleanup:', await client.dbSize());
await probe.close();
await client.close();