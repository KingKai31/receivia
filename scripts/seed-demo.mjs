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
const history = JSON.parse(fs.readFileSync('supabase/seed/demo-history.json', 'utf8'));
const IST_TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const addDays = (iso, n) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);
const nextDayOfMonth = (day) => {
  const [y, m, d] = IST_TODAY.split('-').map(Number);
  const t = day >= d ? new Date(Date.UTC(y, m - 1, day)) : new Date(Date.UTC(y, m, day));
  return t.toISOString().slice(0, 10);
};
const fyOf = (iso) => {
  const y = Number(iso.slice(0, 4));
  const start = Number(iso.slice(5, 7)) >= 4 ? y : y - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
};

/** 6 months of invoices (paid in the past or still open), recurring expenses and cash settings. */
async function seedHistory(c, ids) {
  for (const cu of history.customers) {
    if (ids[cu.key]) continue;
    const ex = await c.query('select id from public.customers where org_id = $1 and name = $2', [
      DEMO_ORG,
      cu.name,
    ]);
    ids[cu.key] =
      ex.rows[0]?.id ??
      (
        await c.query(
          `insert into public.customers (org_id, name, state_code, entity_type, tier, phone, email, credit_days, has_written_agreement)
           values ($1, $2, '27', $3, $4, '9820000099', $5, 30, true) returning id`,
          [DEMO_ORG, cu.name, cu.entity_type, cu.tier, `${cu.key}@example.test`],
        )
      ).rows[0].id;
  }
  let invoices = 0;
  let payments = 0;
  for (const inv of history.invoices) {
    const ex = await c.query('select 1 from public.invoices where org_id = $1 and number = $2', [
      DEMO_ORG,
      inv.number,
    ]);
    if (ex.rowCount) continue;
    const issue = addDays(IST_TODAY, inv.issue_off);
    const cgst = Math.round((inv.taxable_paise * 9) / 100);
    const total = inv.taxable_paise + cgst * 2;
    const id = (
      await c.query(
        `insert into public.invoices (org_id, customer_id, number, fy, status, source, issue_date, due_date,
           supplier_state_code, place_of_supply, taxable_paise, cgst_paise, sgst_paise, total_paise, source_ref)
         values ($1, $2, $3, $4, 'issued', 'import', $5, $6, '27', '27', $7, $8, $8, $9, $10) returning id`,
        [
          DEMO_ORG,
          ids[inv.customer],
          inv.number,
          fyOf(issue),
          issue,
          addDays(IST_TODAY, inv.due_off),
          inv.taxable_paise,
          cgst,
          total,
          `demo:${inv.number}`,
        ],
      )
    ).rows[0].id;
    invoices++;
    if (inv.paid_off !== null) {
      const pay = (
        await c.query(
          `insert into public.payments (org_id, customer_id, amount_paise, received_on, method, status, source, idempotency_key, reference)
           values ($1, $2, $3, $4, 'bank_transfer', 'confirmed', 'manual', $5, $6) returning id`,
          [
            DEMO_ORG,
            ids[inv.customer],
            total,
            addDays(IST_TODAY, inv.paid_off),
            `demo:${inv.number}`,
            `NEFT ${inv.number}`,
          ],
        )
      ).rows[0].id;
      await c.query(
        `insert into public.allocations (org_id, payment_id, invoice_id, amount_paise) values ($1, $2, $3, $4)`,
        [DEMO_ORG, pay, id, total],
      );
      payments++;
    }
  }
  let expenses = 0;
  for (const e of history.expenses) {
    const ex = await c.query('select 1 from public.expenses where org_id = $1 and name = $2', [
      DEMO_ORG,
      e.name,
    ]);
    if (ex.rowCount) continue;
    const first = e.day ? nextDayOfMonth(e.day) : addDays(IST_TODAY, e.due_off);
    await c.query(
      `insert into public.expenses (org_id, name, kind, category, amount_paise, expense_date, is_recurring, recurrence, next_due, can_defer)
       values ($1, $2, $3, $3, $4, $5, $6, $7, $8, $9)`,
      [
        DEMO_ORG,
        e.name,
        e.kind,
        e.amount_paise,
        first,
        Boolean(e.recurrence),
        e.recurrence,
        e.recurrence ? first : null,
        e.can_defer,
      ],
    );
    expenses++;
  }
  await c.query(
    `update public.business_profile set opening_balance_paise = $2, opening_balance_on = $3, safety_buffer_paise = $4 where org_id = $1`,
    [
      DEMO_ORG,
      history.settings.opening_balance_paise,
      IST_TODAY,
      history.settings.safety_buffer_paise,
    ],
  );
  console.log(`demo history: ${invoices} invoices (${payments} paid), ${expenses} expenses`);
}

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
  await seedHistory(c, ids);
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
