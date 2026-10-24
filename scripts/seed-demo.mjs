// Seeds the demo org (Demo Traders) with customers and open invoices that line up with
// supabase/seed/bank-statement.csv. Idempotent: customers by name, invoices by number.
// Usage: node scripts/seed-demo.mjs   (uses TEST_DATABASE_URL from .env.local; never printed)
import fs from 'node:fs';
import pg from 'pg';

const DEMO_ORG = '00000000-0000-4000-8000-00000000de60';
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
}
const data = JSON.parse(fs.readFileSync('supabase/seed/demo-data.json', 'utf8'));
const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await c.connect();
try {
  await c.query('begin');
  const org = await c.query('select 1 from public.orgs where id = $1', [DEMO_ORG]);
  if (!org.rowCount) throw new Error('Demo org missing; run the migrations first.');
  await c.query(
    `update public.business_profile set legal_name = 'Demo Traders', registration_type = 'regular',
       gstin = '27AAPFU0939F1ZV', state_code = '27', udyam_number = 'UDYAM-MH-01-0000001',
       enterprise_size = 'small', activity = 'manufacturing', address = '12 Market Road, Mumbai',
       phone = '9820000000', email = 'accounts@demotraders.example.test', bank_name = 'HDFC Bank',
       bank_account_holder = 'Demo Traders', bank_account_number = '50100000000000', bank_ifsc = 'HDFC0000001',
       upi_id = 'demotraders@upi'
     where org_id = $1`,
    [DEMO_ORG],
  );
  const ids = {};
  for (const cu of data.customers) {
    const ex = await c.query('select id from public.customers where org_id = $1 and name = $2', [
      DEMO_ORG,
      cu.name,
    ]);
    ids[cu.key] =
      ex.rows[0]?.id ??
      (
        await c.query(
          `insert into public.customers (org_id, name, state_code, entity_type, tier, phone, email, credit_days, has_written_agreement)
           values ($1, $2, '27', $3, $4, $5, $6, 30, true) returning id`,
          [DEMO_ORG, cu.name, cu.entity_type, cu.tier, cu.phone, cu.email],
        )
      ).rows[0].id;
  }
  let added = 0;
  for (const inv of data.invoices) {
    const ex = await c.query('select 1 from public.invoices where org_id = $1 and number = $2', [
      DEMO_ORG,
      inv.number,
    ]);
    if (ex.rowCount) continue;
    const cgst = Math.round((inv.taxable_paise * 9) / 100);
    const total = inv.taxable_paise + cgst * 2;
    await c.query(
      `insert into public.invoices (org_id, customer_id, number, fy, status, source, issue_date, due_date,
         supplier_state_code, place_of_supply, taxable_paise, cgst_paise, sgst_paise, total_paise, source_ref)
       values ($1, $2, $3, '26-27', 'issued', 'import', $4, $5, '27', '27', $6, $7, $7, $8, $9)`,
      [
        DEMO_ORG,
        ids[inv.customer],
        inv.number,
        inv.issue_date,
        inv.due_date,
        inv.taxable_paise,
        cgst,
        total,
        `demo:${inv.number}`,
      ],
    );
    added++;
  }
  // Keep the invoice counter ahead of the seeded numbers so the next issued invoice is unique.
  const maxSeq = Math.max(...data.invoices.map((i) => Number(i.number.split('/')[2])));
  const upd = await c.query(
    `update public.invoice_counters set last_seq = greatest(last_seq, $2) where org_id = $1 and fy = '26-27' and series = 'INV'`,
    [DEMO_ORG, maxSeq],
  );
  if (!upd.rowCount) {
    await c.query(
      `insert into public.invoice_counters (org_id, fy, series, last_seq) values ($1, '26-27', 'INV', $2)`,
      [DEMO_ORG, maxSeq],
    );
  }
  await c.query('commit');
  console.log(`demo seed: ${data.customers.length} customers, ${added} new invoices`);
} catch (e) {
  await c.query('rollback');
  console.error('demo seed failed:', e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
