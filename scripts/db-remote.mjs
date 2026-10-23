// Usage: node scripts/db-remote.mjs reset-test | migrate-prod | status <test|prod>
// Reads TEST_DATABASE_URL / PROD_DATABASE_URL from .env.local; never prints them.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

function loadEnv() {
  for (const f of ['.env.local', '.env.local.txt']) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return;
  }
}
loadEnv();
const [cmd, which] = process.argv.slice(2);
const test = process.env.TEST_DATABASE_URL;
const prod = process.env.PROD_DATABASE_URL;
if (!test || !prod) throw new Error('TEST_DATABASE_URL and PROD_DATABASE_URL must be set');
if (test === prod) throw new Error('TEST and PROD urls are identical; refusing');

const dir = 'supabase/migrations';
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

async function connect(url) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  return c;
}

async function ensureLog(c) {
  await c.query(`create schema if not exists receivia_meta`);
  await c.query(`create table if not exists receivia_meta.migrations (name text primary key, applied_at timestamptz default now())`);
}

async function apply(c) {
  await ensureLog(c);
  const done = new Set((await c.query('select name from receivia_meta.migrations')).rows.map((r) => r.name));
  for (const f of files) {
    if (done.has(f)) continue;
    await c.query('begin');
    try {
      await c.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      await c.query('insert into receivia_meta.migrations(name) values ($1)', [f]);
      await c.query('commit');
      console.log('applied', f);
    } catch (e) {
      await c.query('rollback');
      console.error('FAILED', f, e.message);
      process.exitCode = 1;
      return;
    }
  }
}

if (cmd === 'reset-test') {
  const c = await connect(test);
  await c.query('drop schema if exists app cascade');
  await c.query('drop schema if exists receivia_meta cascade');
  await c.query('drop schema if exists public cascade');
  await c.query('create schema public');
  await c.query('grant usage on schema public to postgres, anon, authenticated, service_role');
  await c.query('alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role');
  await c.query('alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role');
  await c.query('alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role');
  await apply(c);
  await c.end();
} else if (cmd === 'migrate-prod') {
  const c = await connect(prod);
  await apply(c);
  await c.end();
} else if (cmd === 'status') {
  const c = await connect(which === 'prod' ? prod : test);
  await ensureLog(c);
  console.log((await c.query('select name from receivia_meta.migrations order by name')).rows.map((r) => r.name).join(', '));
  await c.end();
}
