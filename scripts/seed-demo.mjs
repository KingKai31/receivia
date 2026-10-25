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
    const ex = await c.query('select id from public.customers where org_id = $1 and name = $2', [
      DEMO_ORG,
      cu.name,
    ]);
    ids[cu.key] =
      ex.rows[0]?.id ??
      (
        await c.query(
          `insert into public.customers (org_id, name, gstin, state_code, entity_type, tier, language, phone, email, credit_days, has_written_agreement, is_psu)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 30, true, $10) returning id`,
          [
            DEMO_ORG,
            cu.name,
            cu.gstin,
            cu.state_code,
            cu.entity_type,
            cu.tier,
            cu.language,
            cu.phone,
            cu.email,
            cu.is_psu,
          ],
        )
      ).rows[0].id;
  }

  const invoices = buildInvoices(TODAY);
  const invId = {};
  let added = 0;
  for (const inv of invoices) {
    const ex = await c.query('select id from public.invoices where org_id = $1 and number = $2', [
      DEMO_ORG,
      inv.number,
    ]);
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
          DEMO_ORG,
          ids[inv.customer],
          inv.number,
          fyOf(inv.issue),
          inv.issue,
          inv.due,
          inv.place,
          inv.taxable_paise,
          inv.cgst,
          inv.sgst,
          inv.igst,
          inv.total_paise,
          `demo:${inv.number}`,
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
          [
            DEMO_ORG,
            ids[inv.customer],
            inv.total_paise,
            addDays(TODAY, inv.paid_off),
            `demo:${inv.number}`,
            `NEFT ${inv.number}`,
          ],
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
    const ex = await c.query(
      `select 1 from public.${table} where org_id = $1 and invoice_id = $2`,
      [DEMO_ORG, invId[invoice.number]],
    );
    if (!ex.rowCount)
      await c.query(sql, [DEMO_ORG, invId[invoice.number], ids[invoice.customer], ...args]);
  };
  await story(
    'disputes',
    b.aurangDispute,
    `insert into public.disputes (org_id, invoice_id, customer_id, reason, raised_via) values ($1, $2, $3, $4, 'portal')`,
    [
      'Short delivery: 200 boxes of the 1,000 ordered did not arrive. Please issue a credit note for the missing boxes.',
    ],
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
    [
      'UPI-SAI-7741',
      addDays(TODAY, -2),
      b.saiClaim.total_paise,
      'Paid by UPI on Friday evening, please check.',
    ],
  );

  // S10 story rows (need migration 0012): a draft that fails payability, one buyer-confirmed acceptance,
  // one pending instalment request, one confirmed statement. Skipped until the migration is applied.
  const s10 = (await c.query("select to_regclass('public.instalment_plans') as t")).rows[0].t;
  if (s10) {
    const raj = ids.raj;
    const draftRef = 'demo:s10-draft';
    if (
      !(
        await c.query('select 1 from public.invoices where org_id = $1 and source_ref = $2', [
          DEMO_ORG,
          draftRef,
        ])
      ).rowCount
    ) {
      const d = (
        await c.query(
          `insert into public.invoices (org_id, customer_id, fy, status, source, issue_date, due_date, supplier_state_code,
             place_of_supply, taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise, source_ref, payability_score)
           values ($1, $2, $3, 'draft', 'manual', $4, $5, '27', '27', 10000000, 900000, 900000, 0, 11800000, $6, 45) returning id`,
          [DEMO_ORG, raj, fyOf(TODAY), TODAY, addDays(TODAY, 30), draftRef],
        )
      ).rows[0].id;
      await c.query(
        `insert into public.invoice_lines (org_id, invoice_id, position, description, qty, rate_paise, gst_rate, taxable_paise, cgst_paise, sgst_paise, total_paise)
         values ($1, $2, 1, 'Corrugated boxes, 5-ply', 1000, 10000, 18, 10000000, 900000, 900000, 11800000)`,
        [DEMO_ORG, d],
      );
    }
    await c.query(
      `update public.invoices set accepted_on = $3, acceptance_source = 'buyer_confirmed', acceptance_note = 'Received at gate, signed by stores'
       where id = $1 and org_id = $2`,
      [invId[b.puneOverdue.number], DEMO_ORG, addDays(b.puneOverdue.issue, 2)],
    );
    const mi = b.mithaiOverdue;
    if (
      !(
        await c.query(
          'select 1 from public.instalment_plans where org_id = $1 and invoice_id = $2',
          [DEMO_ORG, invId[mi.number]],
        )
      ).rowCount
    ) {
      const half = Math.floor(mi.total_paise / 2);
      const plan = (
        await c.query(
          `insert into public.instalment_plans (org_id, invoice_id, customer_id, total_paise) values ($1, $2, $3, $4) returning id`,
          [DEMO_ORG, invId[mi.number], ids[mi.customer], mi.total_paise],
        )
      ).rows[0].id;
      for (const [seq, off, amt] of [
        [1, 10, half],
        [2, 24, mi.total_paise - half],
      ])
        await c.query(
          `insert into public.instalments (org_id, plan_id, seq, due_on, amount_paise) values ($1, $2, $3, $4, $5)`,
          [DEMO_ORG, plan, seq, addDays(TODAY, off), amt],
        );
    }
    const open = invoices.filter(
      (i) => i.customer === b.puneOverdue.customer && i.paid_off === null,
    );
    if (
      !(
        await c.query(
          'select 1 from public.statement_responses where org_id = $1 and customer_id = $2',
          [DEMO_ORG, ids[b.puneOverdue.customer]],
        )
      ).rowCount
    )
      await c.query(
        `insert into public.statement_responses (org_id, customer_id, kind, balance_paise) values ($1, $2, 'confirmed', $3)`,
        [DEMO_ORG, ids[b.puneOverdue.customer], open.reduce((n, i) => n + i.total_paise, 0)],
      );
  }

  let expenses = 0;
  for (const e of EXPENSES) {
    const ex = await c.query('select 1 from public.expenses where org_id = $1 and name = $2', [
      DEMO_ORG,
      e.name,
    ]);
    if (ex.rowCount) continue;
    const first = e.day ? nextDayOfMonth(TODAY, e.day) : addDays(TODAY, e.due_off);
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

  // Opening balance: leaves week 3 about ₹1,30,000 under the buffer (calibrated against the real forecast engine).
  const opening = calibrateOpening(forecast, TODAY);
  await c.query(
    'update public.business_profile set opening_balance_paise = $2, opening_balance_on = $3, safety_buffer_paise = $4 where org_id = $1',
    [DEMO_ORG, opening, TODAY, BUFFER_PAISE],
  );

  // One confirmed GST TDS entry (2% of Rs 5,00,000, City Hospital), certificate pending, so /payments/tds is not empty.
  // Not linked to an invoice, so no balance moves and the forecast calibration is untouched.
  await c.query(
    `insert into public.tds_entries (org_id, customer_id, section, rate, amount_paise, taxable_paise, deducted_on, financial_year, certificate_status)
     select $1, cu.id, 'GST_TDS', 2, 1000000, 50000000, $2, $3, 'pending'
       from public.customers cu where cu.org_id = $1 and cu.name = 'City Hospital'
        and not exists (select 1 from public.tds_entries t where t.org_id = $1 and t.customer_id = cu.id and t.section = 'GST_TDS')`,
    [DEMO_ORG, addDays(TODAY, -20), fyOf(TODAY)],
  );

  // Keep the invoice counter ahead of the seeded numbers so the next issued invoice is unique.
  const fy = fyOf(TODAY);
  const upd = await c.query(
    `update public.invoice_counters set last_seq = greatest(last_seq, $3) where org_id = $1 and fy = $2 and series = 'INV'`,
    [DEMO_ORG, fy, invoices.length],
  );
  if (!upd.rowCount)
    await c.query(
      `insert into public.invoice_counters (org_id, fy, series, last_seq) values ($1, $2, 'INV', $3)`,
      [DEMO_ORG, fy, invoices.length],
    );
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
