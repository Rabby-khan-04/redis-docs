/**
 * Chapter 15 - RedisJSON
 * Run:  node examples/15-json.mjs
 *
 * ⚠️ RedisJSON is a MODULE. Use the `modules: { json }` option -- the plain
 *    `createClient()` has no `c.json`.
 *
 * ⚠️ In an ESM project the module client is double-wrapped by CJS interop:
 *      import json from '@redis/json'            -> { default: {...commands} }
 *    so you must unwrap TWICE:
 *      const json = (await import('@redis/json')).default.default;
 */
import { createClient } from 'redis';

const json = (await import('@redis/json')).default.default;   // ← note the double .default

const client = createClient({ url: 'redis://127.0.0.1:6379', modules: { json } });
await client.connect();

const P = 'ch15:';
const keys = [];

// ---------------------------------------------------------------------------
// 1. Store a whole JSON document
// ---------------------------------------------------------------------------
console.log('--- basics ---');
const doc = {
  name: 'Roberta McDonald',
  pets: [
    { name: 'Rex', species: 'dog', age: 3, isMammal: true },
    { name: 'Goldie', species: 'fish', age: 2, isMammal: false },
  ],
};
await client.json.set(P + 'doc', '$', doc); keys.push(P + 'doc');
console.log('JSON.SET ->', 'OK');
console.log('TYPE     ->', await client.type(P + 'doc'), '  (a JSON value is type "ReJSON-RL")');
console.log('JSON.GET ->', await client.json.get(P + 'doc'));

// ---------------------------------------------------------------------------
// 2. ⭐ JSONPath: read only the part you want
// ---------------------------------------------------------------------------
// 🔴 The path is an OPTION: json.get(key, { path: '$.name' }).
//    Passing it positionally SILENTLY returns the WHOLE document.
console.log('\n--- JSONPath reads ---');
const p = (path) => client.json.get(P + 'doc', { path });
console.log("$.name                ->", await p('$.name'));
console.log("$.pets[*].name         ->", await p('$.pets[*].name'));
console.log("$.pets[0]              ->", await p('$.pets[0]'));
console.log("$.pets[?(@.age>2)]     ->", await p('$.pets[?(@.age>2)]'));
console.log("$.pets[1].species      ->", await p('$.pets[1].species'));
console.log('two paths at once      ->', await client.json.get(P + 'doc', { path: ['$.name', '$.pets[0].species'] }));

// ---------------------------------------------------------------------------
// 3. ⭐ Partial updates -- no read-modify-write
// ---------------------------------------------------------------------------
console.log('\n--- partial updates (the big win over strings) ---');
console.log('before name    ->', await client.json.get(P + 'doc', { path: '$.name' }));
await client.json.set(P + 'doc', '$.name', 'Roberta Smith');
console.log('after SET name ->', await client.json.get(P + 'doc', { path: '$.name' }));
console.log('  ^ the rest of the document was never read or rewritten');

// arrays
console.log('\narray append:');
await client.json.set(P + 'arr', '$', ['a']); keys.push(P + 'arr');
console.log("  before        ->", await client.json.get(P + 'arr'));
console.log('  arrAppend b   ->', await client.json.arrAppend(P + 'arr', '$', 'b'));
console.log('  after         ->', await client.json.get(P + 'arr'));
console.log('  arrInsert 0 z ->', await client.json.arrInsert(P + 'arr', '$', 0, 'z'));
console.log('  after         ->', await client.json.get(P + 'arr'));
console.log('  arrIndex $.[1]->', await client.json.arrIndex(P + 'arr', '$', 'b'), '(0-based)');
console.log('  arrPop        ->', await client.json.arrPop(P + 'arr', '$'));
console.log('  after         ->', await client.json.get(P + 'arr'));

// object helpers
console.log('\nobject helpers:');
console.log('  objKeys $     ->', await client.json.objKeys(P + 'doc', '$'));
console.log('  objLen  $     ->', await client.json.objLen(P + 'doc', '$'));
console.log('  type     $    ->', await client.json.type(P + 'doc', '$'));

// ---------------------------------------------------------------------------
// 4. ⚠️ The ARRAPPEND-on-missing-path trap
// ---------------------------------------------------------------------------
console.log('\n--- ⚠️ paths must exist ---');
await client.json.set(P + 'noarr', '$', { name: 'x' }); keys.push(P + 'noarr');
const before = await client.json.get(P + 'noarr');
await client.json.arrAppend(P + 'noarr', '$.tags', 'x');
const after = await client.json.get(P + 'noarr');
console.log('arrAppend onto a path that does not exist:');
console.log('  before ->', before);
console.log('  after  ->', after, '  <- unchanged, silently');
console.log('  FIX: create the array first');
await client.json.set(P + 'noarr', '$.tags', []);
await client.json.arrAppend(P + 'noarr', '$.tags', 'x');
console.log('  after  ->', await client.json.get(P + 'noarr'));

// ---------------------------------------------------------------------------
// 5. Multi and merge
// ---------------------------------------------------------------------------
await client.json.set(P + 'm1', '$', { a: 1, b: 2 }); keys.push(P + 'm1');
await client.json.set(P + 'm2', '$', { b: 3, c: 4 }); keys.push(P + 'm2');
console.log('\n--- multi ---');
// mGet needs BOTH the keys and a path.
console.log('json.mGet([m1,m2], "$") ->', await client.json.mGet([P + 'm1', P + 'm2'], '$'));

console.log('\n--- merge (RFC 7396: null deletes a key) ---');
await client.json.set(P + 'merged', '$', { a: 1, b: 2 }); keys.push(P + 'merged');
await client.json.merge(P + 'merged', '$', { b: 99, c: 3, d: null });
console.log('merge ->', await client.json.get(P + 'merged'));
console.log('  ^ "d": null DELETED the key (RFC 7396 semantics)');

// ---------------------------------------------------------------------------
// 6. numIncrBy on a numeric path
// ---------------------------------------------------------------------------
await client.json.set(P + 'counters', '$', { views: 10, likes: 3 }); keys.push(P + 'counters');
console.log('\n--- numIncrBy ---');
console.log('numIncrBy $.views 5 ->', await client.json.numIncrBy(P + 'counters', '$.views', 5));
console.log('document ->', await client.json.get(P + 'counters'));

// ---------------------------------------------------------------------------
// 7. JSON vs string vs hash
// ---------------------------------------------------------------------------
console.log('\n--- comparison: change one nested field three ways ---');
const base = { user: { id: 42, name: 'Ada', prefs: { theme: 'dark', lang: 'en' } } };

// string + JSON.parse/stringify
await client.set(P + 'as:string', JSON.stringify(base)); keys.push(P + 'as:string');
const s = JSON.parse(await client.get(P + 'as:string'));
s.user.prefs.theme = 'light';
await client.set(P + 'as:string', JSON.stringify(s));
console.log('string  ->', await client.get(P + 'as:string'));

// RedisJSON
await client.json.set(P + 'as:json', '$', base); keys.push(P + 'as:json');
await client.json.set(P + 'as:json', '$.user.prefs.theme', 'light');
console.log('json    ->', await client.json.get(P + 'as:json', { path: '$.user.prefs' }));
console.log('  ^ ONE command, ONE path. No parse, no full rewrite.');

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------
await client.del(keys);
console.log('\nDBSIZE after cleanup:', await client.dbSize());
await client.close();