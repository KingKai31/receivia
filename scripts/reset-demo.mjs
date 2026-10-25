// Puts the demo org back to its seeded story: removes payments, bank lines, TDS, claims, disputes, promises,
// reminders, messages, pay tokens, invoices, customers and expenses, then re-seeds (scripts/seed-demo.mjs).
// The org, business profile and audit_log stay (audit_log is append-only). Touches the demo org only.
// Runs nightly as the Render cron job receivia-demo-reset (needs TEST_DATABASE_URL in its environment).
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const DEMO_ORG = '00000000-0000-4000-8000-00000000de60';
if (fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
  }
}
const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await c.connect();
try {
  await c.query('begin');
  for (const t of [
    'instalments',
    'instalment_plans',
    'delivery_proofs',
    'statement_responses',
    'statement_tokens',
    'negotiation_log',
    'discount_offers',
  ]) {
    // These exist only once migration 0012 is applied; they must go before invoices and customers.
    const has = (await c.query('select to_regclass($1) as t', [`public.${t}`])).rows[0].t;
    if (has) await c.query(`delete from public.${t} where org_id = $1`, [DEMO_ORG]);
  }
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
    'notes',
    'invoice_lines',
    'ims_status',
    'customer_consents',
    'invoices',
    'expenses',
    'customers',
    'invoice_counters',
  ]) {
    await c.query(`delete from public.${t} where org_id = $1`, [DEMO_ORG]);
  }
  await c.query('delete from public.rate_limits');
  await c.query('commit');
} catch (e) {
  await c.query('rollback');
  console.error('reset failed:', e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
if (!process.exitCode) {
  const r = spawnSync('node', ['scripts/seed-demo.mjs'], { stdio: 'inherit' });
  if (r.status) process.exitCode = r.status;
}
