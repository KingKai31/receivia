// Seeds the demo org (Shree Ganesh Corrugators) with the demo story from supabase/seed/demo-story.mjs.
// Idempotent: customers by name, invoices by number, expenses by name, story rows once per invoice.
// All dates are offsets from the demo date: DEMO_DATE=YYYY-MM-DD, default today (IST), also pinned as
// business_profile.demo_date so the agent planner agrees. The nightly reset re-runs this for a fresh story.
// Usage: node scripts/seed-demo.mjs   (uses TEST_DATABASE_URL from .env.local or the environment)
import fs from 'node:fs';
import pg from 'pg';
import * as forecast from '../supabase/seed/forecast.bundle.js';
import {
  BUFFER_PAISE,
  CUSTOMERS,
  DEMO_ORG,
  EXPENSES,
  PROFILE,
  addDays,
  beats,
  buildInvoices,
  calibrateOpening,
  fyOf,
  istToday,
  nextDayOfMonth,
} from '../supabase/seed/demo-story.mjs';

if (fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
  }
}
const TODAY = process.env.DEMO_DATE || istToday();

const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await c.connect();
try {
  await c.query('begin');
  const org = await c.query('select 1 from public.orgs where id = $1', [DEMO_ORG]);
  if (!org.rowCount) throw new Error('Demo org missing; run the migrations first.');
  await c.query('update public.orgs set name = $2 where id = $1', [DEMO_ORG, PROFILE.legal_name]);
  const { employees: _employees, ...p } = PROFILE;
  const cols = Object.keys(p);
  await c.query(
    `update public.business_profile set ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')}, demo_date = $${cols.length + 2}
     where org_id = $1`,
    [DEMO_ORG, ...cols.map((k) => p[k]), TODAY],
  );

  const ids = {};
  for (const cu of CUSTOMERS) {
    const ex = await c.query('select id from public.customers where org_id = $1 and name = $2', [DEMO_ORG, cu.name]);
    ids[cu.key] =
      ex.rows[0]?.id ??
      (
        await c.query(
          `insert into public.customers (org_id, name, gstin, state_code, entity_type, tier, language, phone, email, credit_days, has_written_agreement)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 30, true) returning id`,
          [DEMO_ORG, cu.name, cu.gstin, cu.state_code, cu.entity_type, cu.tier, cu.language, cu.phone, cu.email],
        )
      ).rows[0].id;
  }

  const invoices = buildInvoices(TODAY);
  const invId = {};
  let added = 0;
  for (const inv of invoices) {
    const ex = await c.query('select id from public.invoices where org_id = $1 and number = $2', [DEMO_ORG, inv.number]);
    if (ex.rowCount) {
      invId[inv.number] = ex.rows[0].id;
      continue;
    }
    const id = (
      await c.query(
        `insert into public.invoices (org_id, customer_id, number, fy, status, source, issue_date, due_date,
           supplier_state_code, place_of_supply, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, source_ref)
         values ($1, $2, $3, $4, 'issued', 'import', $5, $6, '27', $7, $8, $9, $10, $11, $12, $13) returning id`,
        [
          DEMO_ORG, ids[inv.customer], inv.number, fyOf(inv.issue), inv.issue, inv.due, inv.place,
          inv.taxable_paise, inv.cgst, inv.sgst, inv.igst, inv.total_paise, `demo:${inv.number}`,
        ],
      )
    ).rows[0].id;
    invId[inv.number] = id;
    added++;
    if (inv.paid_off !== null) {
      const pay = (
        await c.query(
          `insert into public.payments (org_id, customer_id, amount_paise, received_on, method, status, source, idempotency_key, reference)
           values ($1, $2, $3, $4, 'bank_transfer', 'confirmed', 'manual', $5, $6) returning id`,
          [DEMO_ORG, ids[inv.customer], inv.total_paise, addDays(TODAY, inv.paid_off), `demo:${inv.number}`, `NEFT ${inv.number}`],
        )
      ).rows[0].id;
      await c.query(
        'insert into public.allocations (org_id, payment_id, invoice_id, amount_paise) values ($1, $2, $3, $4)',
        [DEMO_ORG, pay, id, inv.total_paise],
      );
    }
  }

  // Story rows: one open dispute, one active promise, one "already paid" claim waiting in the Inbox.
  const b = beats(invoices);
  const story = async (table, invoice, sql, args) => {
    const ex = await c.query(`select 1 from public.${table} where org_id = $1 and invoice_id = $2`, [
      DEMO_ORG,
      invId[invoice.number],
    ]);
    if (!ex.rowCount) await c.query(sql, [DEMO_ORG, invId[invoice.number], ids[invoice.customer], ...args]);
  };
  await story(
    'disputes',
    b.aurangDispute,
    `insert into public.disputes (org_id, invoice_id, customer_id, reason, raised_via) values ($1, $2, $3, $4, 'portal')`,
    ['Short delivery: 200 boxes of the 1,000 ordered did not arrive. Please issue a credit note for the missing boxes.'],
  );
  await story(
    'promises',
    b.puneOverdue,
    `insert into public.promises (org_id, invoice_id, customer_id, promised_for, source) values ($1, $2, $3, $4, 'portal')`,
    [addDays(TODAY, 3)],
  );
  await story(
    'payment_claims',
    b.saiClaim,
    `insert into public.payment_claims (org_id, invoice_id, customer_id, reference, paid_on, amount_paise, note) values ($1, $2, $3, $4, $5, $6, $7)`,
    ['UPI-SAI-7741', addDays(TODAY, -2), b.saiClaim.total_paise, 'Paid by UPI on Friday evening, please check.'],
  );

  let expenses = 0;
  for (const e of EXPENSES) {
    const ex = await c.query('select 1 from public.expenses where org_id = $1 and name = $2', [DEMO_ORG, e.name]);
    if (ex.rowCount) continue;
    const first = e.day ? nextDayOfMonth(TODAY, e.day) : addDays(TODAY, e.due_off);
    await c.query(
      `insert into public.expenses (org_id, name, kind, category, amount_paise, expense_date, is_recurring, recurrence, next_due, can_defer)
       values ($1, $2, $3, $3, $4, $5, $6, $7, $8, $9)`,
      [DEMO_ORG, e.name, e.kind, e.amount_paise, first, Boolean(e.recurrence), e.recurrence, e.recurrence ? first : null, e.can_defer],
    );
    expenses++;
  }

  // Opening balance: leaves week 3 about ₹1,30,000 under the buffer (calibrated against the real forecast engine).
  const opening = calibrateOpening(forecast, TODAY);
  await c.query(
    'update public.business_profile set opening_balance_paise = $2, opening_balance_on = $3, safety_buffer_paise = $4 where org_id = $1',
    [DEMO_ORG, opening, TODAY, BUFFER_PAISE],
  );

  // Keep the invoice counter ahead of the seeded numbers so the next issued invoice is unique.
  const fy = fyOf(TODAY);
  const upd = await c.query(
    `update public.invoice_counters set last_seq = greatest(last_seq, $3) where org_id = $1 and fy = $2 and series = 'INV'`,
    [DEMO_ORG, fy, invoices.length],
  );
  if (!upd.rowCount)
    await c.query(`insert into public.invoice_counters (org_id, fy, series, last_seq) values ($1, $2, 'INV', $3)`, [
      DEMO_ORG,
      fy,
      invoices.length,
    ]);
  await c.query('commit');
  console.log(
    `demo seed (${TODAY}): ${CUSTOMERS.length} customers, ${added} new invoices, ${expenses} new expenses, opening Rs ${(opening / 100).toLocaleString('en-IN')}`,
  );
} catch (e) {
  await c.query('rollback');
  console.error('demo seed failed:', e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
