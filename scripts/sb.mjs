// Runs the Supabase CLI non-interactively with secrets from .env.local (never printed).
// Usage: node scripts/sb.mjs <supabase args...>   ($REF in args becomes SUPABASE_PROJECT_REF)
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
}
const args = process.argv
  .slice(2)
  .map((a) => (a === '$REF' ? process.env.SUPABASE_PROJECT_REF : a));
const r = spawnSync('npx', ['supabase', ...args], { stdio: 'inherit', shell: true });
process.exit(r.status ?? 1);
