// Merges [[english, hindi, marathi], ...] from a JSON file into src/locales/{hi,mr}.json.
import fs from 'node:fs';

const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const load = (l) => JSON.parse(fs.readFileSync(`src/locales/${l}.json`, 'utf8'));
const hi = load('hi');
const mr = load('mr');
for (const [en, h, m] of rows) {
  hi[en] = h;
  mr[en] = m;
}
const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync('src/locales/hi.json', JSON.stringify(sorted(hi), null, 2) + '\n');
fs.writeFileSync('src/locales/mr.json', JSON.stringify(sorted(mr), null, 2) + '\n');
console.log('merged', rows.length);
