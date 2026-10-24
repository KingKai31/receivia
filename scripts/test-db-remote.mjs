// Runs the DB test suite against TEST_DATABASE_URL from .env.local (never printed).
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.REQUIRE_DB = '1';
process.env.REMOTE_DB = '1';
const r = spawnSync(
  'npx',
  ['vitest', 'run', '--config', 'vitest.db.config.ts', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    shell: true,
  },
);
process.exit(r.status ?? 1);
