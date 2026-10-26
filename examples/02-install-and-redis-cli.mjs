/**
 * Chapter 02 - Install and redis-cli
 * Run:  node examples/02-install-and-redis-cli.mjs
 */
import { createClient } from 'redis';

const client = createClient({ url: 'redis://127.0.0.1:6379' });
await client.connect();

// --- Where am I connected? -----------------------------------------------
const info = await client.info('server');
const pick = (s, re) => s.match(re)?.[1] ?? '(not found)';
console.log('version      :', pick(info, /redis_version:(\S+)/));
console.log('mode         :', pick(info, /redis_mode:(\S+)/));
console.log('port         :', pick(info, /tcp_port:(\S+)/));
console.log('os / arch    :', pick(info, /os:(\S+)/), '/', pick(info, /arch_bits:(\S+)/));
console.log('uptime (days):', pick(info, /uptime_in_days:(\S+)/));

// --- How many commands does this server know? ----------------------------
console.log('commands     :', await client.commandCount());

// --- Which modules (extra features) are loaded? --------------------------
const mods = await client.sendCommand(['MODULE', 'LIST']);
console.log('modules      :', mods.map(m => `${m.name} (v${m.ver})`).join(', '));

// --- Settings are just key/value config ----------------------------------
console.log('databases    :', (await client.configGet('databases')).databases);
console.log('maxmemory    :', (await client.configGet('maxmemory')).maxmemory, '(0 = unlimited)');
console.log('save policy  :', (await client.configGet('save')).save);
console.log('appendonly   :', (await client.configGet('appendonly')).appendonly);

// --- Confirm the RESP protocol version in use ----------------------------
const ci = await client.sendCommand(['CLIENT', 'INFO']);
console.log('resp version :', ci.match(/resp=(\d+)/)[1]);
console.log('lib          :', ci.match(/lib-name=(\S+)/)[1], ci.match(/lib-ver=(\S+)/)[1]);

// --- A quick tour of what is stored right now ----------------------------
console.log('dbsize       :', await client.dbSize());

// --- COMMAND DOCS: ask the server to explain any command -----------------
// Reply shape (RESP3): { "<command in lower case>": { summary, complexity, ... } }
// The inner value is an array for commands that have a version history.
async function docs(name) {
  const reply = await client.sendCommand(['COMMAND', 'DOCS', name]);
  const doc = reply[name.toLowerCase()];
  return Array.isArray(doc) ? doc[0] : doc;
}

const get = await docs('GET');
console.log('GET  ->', get.summary, '|', get.complexity, '| since', get.since);

const keys = await docs('KEYS');
console.log('KEYS ->', keys.summary, '|', keys.complexity);
console.log('       ^ O(N) over the whole database. Do not run this in production.');

const smembers = await docs('SMEMBERS');
console.log('SMEMBERS ->', smembers.complexity, '|', smembers.summary);

await client.close();