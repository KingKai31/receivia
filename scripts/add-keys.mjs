import fs from 'node:fs';
const [,, file] = process.argv;
const add = JSON.parse(fs.readFileSync(file, 'utf8'));
for (const l of ['en','hi','mr']) {
  const p = `src/locales/${l}.json`;
  const j = JSON.parse(fs.readFileSync(p,'utf8'));
  for (const [k, v] of Object.entries(add)) if (!(k in j) && (l!=='en' || /^[a-z]+./.test(k))) j[k] = l==='en' ? v[0] : v[l==='hi'?1:2];
  const sorted = l==='en' ? j : Object.fromEntries(Object.entries(j).sort(([a],[b])=>a<b?-1:a>b?1:0));
  fs.writeFileSync(p, JSON.stringify(sorted, null, 2)+'\n');
}
