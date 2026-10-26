/**
 * Chapter 26 - Security
 * Run:  node examples/26-security.mjs
 */
import { createClient } from 'redis';

const admin = createClient({ url: 'redis://127.0.0.1:6379' });
await admin.connect();

const P = 'ch26:';

console.log('--- who am I? (default user) ---');
console.log('ACL WHOAMI ->', await admin.aclWhoAmI());
console.log('ACL LIST   ->', await admin.aclList());
console.log('  ^ no password, all keys, all commands. This is the default. Change it.');

console.log('\n--- creating a read-only user ---');
await admin.sendCommand(['ACL', 'SETUSER', 'reader', 'on', '>secret123', '~*', '+@read']);
console.log('ACL SETUSER reader on >secret123 ~* +@read -> OK');
const gu = await admin.aclGetUser('reader');
console.log('ACL GETUSER reader ->', JSON.stringify(gu).slice(0, 120) + '...');

const reader = createClient({ url: 'redis://reader:secret123@127.0.0.1:6379' });
await reader.connect();
console.log('AUTH reader secret123 -> OK (connection authenticated)');
await admin.set(P + 'value', 'hello');
console.log('GET with reader ->', await reader.get(P + 'value'));
try {
  await reader.set(P + 'value', 'nope');
} catch (e) {
  console.log('SET with reader ->', e.message);
  console.log('  ^ read-only user cannot write. Verified.');
}
await reader.close();

console.log('\n--- scoped user (prefix + command categories) ---');
await admin.sendCommand(['ACL', 'SETUSER', 'scoped', 'on', '>scopedpass', '~app:*', '+@read', '+@write', '-@dangerous']);
const scoped = createClient({ url: 'redis://scoped:scopedpass@127.0.0.1:6379' });
await scoped.connect();
await admin.set('app:foo', 'foo');
console.log('scoped can read app:foo  ->', await scoped.get('app:foo'));
try {
  await scoped.get('other:x');
} catch (e) {
  console.log('scoped cannot read other:x ->', e.message);
}
await scoped.set('app:bar', 'bar');
console.log('scoped can write app:bar ->', await scoped.get('app:bar'));
try {
  await scoped.flushDb();
} catch (e) {
  console.log('scoped cannot FLUSHDB    ->', e.message);
}
await scoped.close();

console.log('\n--- ACL LOG (auth failures) ---');
await admin.sendCommand(['ACL', 'LOG', 'RESET']).catch(() => {});
// trigger a failure
const bad = createClient({ url: 'redis://reader:wrongpass@127.0.0.1:6379' });
await bad.connect().catch(() => {});
await new Promise(r => setTimeout(r, 200));
const log = await admin.aclLog();
console.log('ACL LOG length ->', log.length);
if (log.length) console.log('last entry ->', JSON.stringify(log[0]).slice(0, 120));

console.log('\n--- connection kill ---');
const victim = createClient({ url: 'redis://127.0.0.1:6379' });
victim.on('error', () => { /* killed, expected */ });
await victim.connect();
const id = await victim.clientId();
console.log('victim clientId ->', id);
console.log('CLIENT KILL ID ->', await admin.sendCommand(['CLIENT', 'KILL', 'ID', String(id)]));
await new Promise(r => setTimeout(r, 200));
console.log('  ^ victim connection is now dead; its error event was captured, not a crash');

console.log('\n--- dangerous commands to disable in production ---');
for (const c of ['FLUSHALL', 'FLUSHDB', 'KEYS', 'CONFIG', 'DEBUG', 'SHUTDOWN']) console.log('  ' + c);

// cleanup
await admin.sendCommand(['ACL', 'DELUSER', 'reader']).catch(() => {});
await admin.sendCommand(['ACL', 'DELUSER', 'scoped']).catch(() => {});
await admin.del([P + 'value', 'app:foo', 'app:bar']);
console.log('\nDBSIZE after cleanup:', await admin.dbSize());
await admin.close();