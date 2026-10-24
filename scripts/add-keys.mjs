// Adds translation keys. Usage: node scripts/add-keys.mjs keys.json
// keys.json: { "key": [english, hindi, marathi] }. English is stored only for namespaced keys
// (nav.more); plain English phrases fall back to the key itself.
import fs from 'node:fs';

const add = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const namespaced = /^[a-z]+\.[A-Za-z]/;
for (const l of ['en', 'hi', 'mr']) {
  const p = `src/locales/${l}.json`;
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  for (const [k, v] of Object.entries(add)) {
    if (k in j) continue;
    if (l === 'en') {
      if (namespaced.test(k)) j[k] = v[0];
    } else j[k] = v[l === 'hi' ? 1 : 2];
  }
  const out =
    l === 'en'
      ? j
      : Object.fromEntries(Object.entries(j).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  fs.writeFileSync(p, JSON.stringify(out, null, 2) + '\n');
}
