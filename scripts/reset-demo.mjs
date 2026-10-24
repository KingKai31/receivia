// Puts the demo org back to its seeded state: removes payments, bank lines, TDS, claims, disputes,
// promises, reminders, messages and pay tokens, then re-seeds. audit_log is append-only and stays.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const DEMO_ORG = '00000000-0000-4000-8000-00000000de60';
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
}
const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await c.connect();
try {
  await c.query('begin');
  for (const t of [
    'tds_entries',
    'allocations',
    'bank_txns',
    'payments',
    'promises',
    'payment_claims',
    'disputes',
    'messages',
    'reminders',
    'pay_tokens',
    'agent_actions',
  ]) {
    await c.query(`delete from public.${t} where org_id = $1`, [DEMO_ORG]);
  }
  // Generated history: invoices (HIS series), expenses and the customers only the history uses.
  await c.query(`delete from public.invoices where org_id = $1 and number like 'HIS/%'`, [
    DEMO_ORG,
  ]);
  await c.query('delete from public.expenses where org_id = $1', [DEMO_ORG]);
  const base = JSON.parse(fs.readFileSync('supabase/seed/demo-data.json', 'utf8')).customers.map(
    (x) => x.name,
  );
  await c.query(
    `delete from public.customers where org_id = $1 and name <> all($2::text[]) and not exists
       (select 1 from public.invoices i where i.customer_id = customers.id and i.org_id = customers.org_id)`,
    [DEMO_ORG, base],
  );
  await c.query('delete from public.rate_limits');
  await c.query('commit');
} catch (e) {
  await c.query('rollback');
  console.error('reset failed:', e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
if (!process.exitCode) spawnSync('node', ['scripts/seed-demo.mjs'], { stdio: 'inherit' });
