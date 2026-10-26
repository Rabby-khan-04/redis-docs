/**
 * Chapter 16 - Search and querying (RediSearch)
 * Run:  node examples/16-search.mjs
 *
 * ⚠️ RediSearch is a MODULE. Use `modules: { search }`.
 */
import { createClient } from 'redis';

const search = (await import('@redis/search')).default.default;
const { SCHEMA_FIELD_TYPE } = await import('@redis/search');

const client = createClient({ url: 'redis://127.0.0.1:6379', modules: { search } });
await client.connect();

const P = 'ch16:';
const keys = [];

// ---------------------------------------------------------------------------
// 1. Index HASHES: people
// ---------------------------------------------------------------------------
console.log('--- creating a HASH index ---');
await client.ft.dropIndex('idx:people').catch(() => {});
await client.ft.create('idx:people', {
  name: { type: SCHEMA_FIELD_TYPE.TEXT, SORTABLE: true },
  age: { type: SCHEMA_FIELD_TYPE.NUMERIC, SORTABLE: true },
  city: { type: SCHEMA_FIELD_TYPE.TAG, SORTABLE: true },
  bio: { type: SCHEMA_FIELD_TYPE.TEXT },
}, { ON: 'HASH', PREFIX: P + 'person:' });

const people = [
  { name: 'Ada Lovelace', age: '36', city: 'London', bio: 'mathematician and first programmer' },
  { name: 'Alan Turing', age: '41', city: 'London', bio: 'computational theory and cryptography' },
  { name: 'Grace Hopper', age: '85', city: 'New York', bio: 'compiler pioneer and admiral' },
  { name: 'Edsger Dijkstra', age: '72', city: 'Rotterdam', bio: 'shortest path algorithms' },
  { name: 'Barbara Liskov', age: '84', city: 'Boston', bio: 'abstraction and substitutability' },
];
for (const p of people) await client.hSet(P + 'person:' + p.name, p);

console.log('FT.CREATE idx:people -> OK');
console.log('FT._list ->', await client.ft._list());
console.log('documents indexed ->', people.length);

// Wait for the index to catch up
await new Promise(r => setTimeout(r, 300));

// ---------------------------------------------------------------------------
// 2. Text search (TEXT fields only: name, bio. NOT city -- that is a TAG)
// ---------------------------------------------------------------------------
console.log('\n--- text search ---');
const show = async (q, label) => {
  const r = await client.ft.search('idx:people', q);
  console.log(`${label.padEnd(40)} -> ${r.total} : ${r.documents.map(d => d.value.name).join(', ') || '(none)'}`);
};

await show('programmer', 'programmer');
await show('London', 'London  (⚠️ 0: city is a TAG, not TEXT)');
await show('@bio:(compiler)', '@bio:(compiler)');
await show('@name:(Alan)', '@name:(Alan)');

// ---------------------------------------------------------------------------
// 3. ⭐ Boolean operators: space = AND, | = OR, - = NOT
// ---------------------------------------------------------------------------
console.log('\n--- boolean operators ---');
console.log('NOTE: the word OR does NOT work as boolean here. Use the pipe character |');
await show('compiler cryptography', 'compiler cryptography   (AND, 0 docs)');
await show('compiler|cryptography', 'compiler|cryptography  (OR, 2 docs)');
await show('@bio:(compiler|cryptography)', '@bio:(compiler|cryptography)');
await show('@bio:(compiler) -@city:{London}', '@bio:(compiler) -@city:{London}');
await show('@city:{London} @age:[30 50]', '@city:{London} AND @age:[30 50]');
await show('compil*', 'compil*   (prefix search)');
await show('@name:Alan', '@name:Alan  (implicit field)');
await show('Ada|Norman', 'Ada|Norman   (OR across fields)');
await show('@name:(Ada Grace)', '@name:(Ada Grace)  (both words)');
await show('@name:~Lovlace', '@name:~Lovlace  (fuzzy)');
console.log('  ^ CAUTION: RediSearch default fuzzy distance is very permissive here --');
console.log('    it matched ALL 3 names, not just the typo. Always set an explicit');
console.log('    DISTANCE, or use a prefix search (compil*) for "did you mean" UX.');

// ---------------------------------------------------------------------------
// 4. Numeric ranges
// ---------------------------------------------------------------------------
console.log('\n--- numeric ---');
await show('@age:[30 50]', '@age:[30 50]');
await show('@age:[80 +inf]', '@age:[80 +inf]');
await show('@age:[-inf 40]', '@age:[-inf 40]');

// ---------------------------------------------------------------------------
// 5. TAG fields -- exact, facetable
// ---------------------------------------------------------------------------
console.log('\n--- TAG (exact match) ---');
await show('@city:{London}', '@city:{London}');
await show('@city:{London|New York}', '@city:{London|New York}');
await show('@city:{Lond*}', '@city:{Lond*}  (TAG prefix query)');

// ---------------------------------------------------------------------------
// 6. Sorting results
// ---------------------------------------------------------------------------
// ⚠️ SORTBY is an OBJECT { BY, DIRECTION }. A wrong key like SORTBY_ORDER is
//    SILENTLY ignored and you get unsorted (relevance-ordered) results.
console.log('\n--- sorting ---');
const byAge = await client.ft.search('idx:people', '*', { SORTBY: { BY: 'age', DIRECTION: 'DESC' } });
console.log("SORTBY {BY:'age',DIRECTION:'DESC'}:");
for (const d of byAge.documents) console.log(`   ${String(d.value.age).padStart(3)}  ${d.value.name}`);

const byAgeAsc = await client.ft.search('idx:people', '*', { SORTBY: { BY: 'age', DIRECTION: 'ASC' } });
console.log("SORTBY {BY:'age',DIRECTION:'ASC'}:");
for (const d of byAgeAsc.documents) console.log(`   ${String(d.value.age).padStart(3)}  ${d.value.name}`);

// ---------------------------------------------------------------------------
// 7. Pagination
// ---------------------------------------------------------------------------
console.log('\n--- pagination (LIMIT { from, size }) ---');
for (let off = 0; off < 5; off += 2) {
  const page = await client.ft.search('idx:people', '*', {
    SORTBY: { BY: 'age', DIRECTION: 'DESC' },
    LIMIT: { from: off, size: 2 },
  });
  console.log(`  offset ${off}: ${page.documents.map(d => d.value.name).join(', ')}`);
}

// ---------------------------------------------------------------------------
// 8. Highlighting
// ---------------------------------------------------------------------------
console.log('\n--- highlighting ---');
const hl = await client.ft.search('idx:people', 'compiler', { HIGHLIGHT: { fields: 'bio' } });
for (const d of hl.documents) console.log('  ', JSON.stringify(d));

// ---------------------------------------------------------------------------
// 9. Aggregation -- under RESP3 the reply is a structured object
// ---------------------------------------------------------------------------
console.log('\n--- aggregation (GROUPBY) ---');
const agg = await client.sendCommand(['FT.AGGREGATE', 'idx:people', '*',
  'GROUPBY', '1', '@city', 'REDUCE', 'COUNT', '0', 'AS', 'num']);
console.log('  total_results =', agg.total_results, '(number of GROUPS, not docs)');
for (const row of agg.results) {
  console.log('  ', JSON.stringify(row.extra_attributes));
}
console.log('  ^ TAG values are lowercased ("london") unless you set CASESENSITIVE');
console.log('  (redis-cli shows a flat array instead; RESP3 gives this object shape)');

// ---------------------------------------------------------------------------
// 10. ⭐ Indexing JSON documents too
// ---------------------------------------------------------------------------
const json = (await import('@redis/json')).default.default;
const jclient = createClient({ url: 'redis://127.0.0.1:6379', modules: { json } });
await jclient.connect();

console.log('\n--- indexing JSON (ON JSON) ---');
await client.ft.dropIndex('idx:products').catch(() => {});
await client.ft.create('idx:products', {
  '$.name': { type: SCHEMA_FIELD_TYPE.TEXT, AS: 'name' },
  '$.price': { type: SCHEMA_FIELD_TYPE.NUMERIC, AS: 'price', SORTABLE: true },
  '$.category': { type: SCHEMA_FIELD_TYPE.TAG, AS: 'category' },
}, { ON: 'JSON', PREFIX: P + 'product:' });

await jclient.json.set(P + 'product:1', '$', { name: 'Mechanical Keyboard', price: 89, category: 'peripherals' });
await jclient.json.set(P + 'product:2', '$', { name: 'Wireless Mouse', price: 35, category: 'peripherals' });
await jclient.json.set(P + 'product:3', '$', { name: 'Standing Desk', price: 450, category: 'furniture' });
keys.push(P + 'product:1', P + 'product:2', P + 'product:3');
await new Promise(r => setTimeout(r, 400));

const pn = await client.ft.search('idx:products', 'keyboard');
console.log('search "keyboard" ->', pn.total, pn.documents.map(d => d.id));
const pc = await client.ft.search('idx:products', '@category:{peripherals}');
console.log('category peripherals ->', pc.total, 'products');
const pp = await client.ft.search('idx:products', '@price:[50 500]', { SORTBY: { BY: 'price', DIRECTION: 'ASC' } });
console.log('price 50-500 sorted by price ->',
  pp.documents.map(d => `${d.id.replace(P, '')} price=${d.value.price}`));

await jclient.close();

// ---------------------------------------------------------------------------
// 11. ⚠️ FT.INFO -- check index settings
// ---------------------------------------------------------------------------
console.log('\n--- FT.INFO ---');
const info = await client.ft.info('idx:people');
console.log('index_name:', info.index_name);
console.log('num_docs  :', info.num_docs, ' num_terms:', info.num_terms);
console.log('attributes: an ARRAY of field definitions:');
for (const a of info.attributes) {
  console.log(`   ${a.attribute} (${a.type})${a.flags?.length ? ' ' + JSON.stringify(a.flags) : ''}`);
}

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------
await client.ft.dropIndex('idx:people');
await client.ft.dropIndex('idx:products');
await client.del([...keys, ...people.map(p => P + 'person:' + p.name)]);
console.log('\nDBSIZE after cleanup:', await client.dbSize());
await client.close();