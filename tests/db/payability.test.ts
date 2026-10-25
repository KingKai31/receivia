/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actAs, newUser, openDb } from './harness';

let db: PGlite;
let orgId: string;
let customerId: string;

async function invoice(
  opts: { total?: number; status?: string; score?: number | null; lines?: boolean } = {},
) {
  const total = opts.total ?? 118000;
  const r = await db.query<{ id: string }>(
    `insert into invoices (org_id, customer_id, number, fy, status, issue_date, due_date,
       supplier_state_code, place_of_supply, taxable_paise, cgst_paise, sgst_paise, total_paise, payability_score)
     values ($1, $2, case when $4 = 'draft' then null else 'T/' || substr(gen_random_uuid()::text, 1, 8) end,
       '26-27', $4, '2026-10-01', '2026-10-31', '27', '27', $3, 0, 0, $3, $5)
     returning id`,
    [orgId, customerId, total, opts.status ?? 'issued', opts.score ?? null],
  );
  const id = r.rows[0]!.id;
  if (opts.lines) {
    await db.query(
      `insert into invoice_lines (org_id, invoice_id, position, description, qty, rate_paise, gst_rate,
         taxable_paise, cgst_paise, sgst_paise, total_paise)
       values ($1, $2, 1, 'Item', 1, $3, 0, $3, 0, 0, $3)`,
      [orgId, id, total],
    );
  }
  return id;
}
const token = async (inv: string) =>
  (
    await db.query<{ t: string }>(`select public.create_pay_token($1, interval '60 days') as t`, [
      inv,
    ])
  ).rows[0]!.t;
const extra = (t: string, kind: string, payload: unknown) =>
  db.query<{ id: string }>('select public.pay_extra($1, $2, $3::jsonb) as id', [
    t,
    kind,
    JSON.stringify(payload),
  ]);
const inv = async (id: string) =>
  (await db.query<Record<string, string | null>>('select * from invoices where id = $1', [id]))
    .rows[0]!;

beforeAll(async () => {
  db = await openDb();
  const u = await newUser(db);
  orgId = u.orgId;
  await actAs(db, u.userId);
  customerId = (
    await db.query<{ id: string }>(
      `insert into customers (org_id, name, state_code) values ($1, 'Buyer', '27') returning id`,
      [orgId],
    )
  ).rows[0]!.id;
}, 60000);
afterAll(async () => {
  await db?.close();
});

describe('payability gate', () => {
  it('blocks issue below the threshold, lets the owner override with a reason, logs it', async () => {
    const id = await invoice({ status: 'draft', score: 40, lines: true });
    const upd = (await inv(id)).updated_at as unknown as Date;
    await expect(db.query('select public.issue_invoice($1, $2)', [id, upd])).rejects.toThrow(
      /payability score 40/,
    );
    await expect(db.query('select public.override_payability($1, $2)', [id, ' '])).rejects.toThrow(
      /reason/,
    );
    await db.query('select public.override_payability($1, $2)', [
      id,
      'Regular buyer, PO to follow',
    ]);
    const after = await inv(id);
    expect(after.payability_override).toBe(true);
    const issued = await db.query<{ status: string }>(
      'select status from public.issue_invoice($1, $2)',
      [id, after.updated_at],
    );
    expect(issued.rows[0]!.status).toBe('issued');
    const log = await db.query(
      `select 1 from audit_log where table_name = 'invoices' and record_id = $1 and new_data ->> 'payability_override_reason' is not null`,
      [id],
    );
    expect(log.rows.length).toBeGreaterThan(0);
  });
  it('passes at or above the threshold and when no score was stored', async () => {
    for (const score of [70, 100, null]) {
      const id = await invoice({ status: 'draft', score, lines: true });
      const r = await db.query<{ status: string }>(
        'select status from public.issue_invoice($1, $2)',
        [id, (await inv(id)).updated_at],
      );
      expect(r.rows[0]!.status).toBe('issued');
    }
  });
  it('threshold is configurable per org', async () => {
    await db.query('update business_profile set payability_threshold = 30 where org_id = $1', [
      orgId,
    ]);
    const id = await invoice({ status: 'draft', score: 40, lines: true });
    const r = await db.query<{ status: string }>(
      'select status from public.issue_invoice($1, $2)',
      [id, (await inv(id)).updated_at],
    );
    expect(r.rows[0]!.status).toBe('issued');
    await db.query('update business_profile set payability_threshold = 70 where org_id = $1', [
      orgId,
    ]);
  });
});

describe('acceptance', () => {
  it('buyer confirmation sets the date and source and validates the date', async () => {
    const id = await invoice();
    const t = await token(id);
    await expect(extra(t, 'received', { date: '2026-09-01' })).rejects.toThrow(/between/);
    await expect(extra(t, 'received', { date: '2099-01-01' })).rejects.toThrow(/between/);
    await extra(t, 'received', { date: '2026-10-05', note: 'Received at gate' });
    expect(await inv(id)).toMatchObject({
      acceptance_source: 'buyer_confirmed',
      acceptance_note: 'Received at gate',
    });
    expect(String((await inv(id)).accepted_on)).toContain('2026');
  });
  it('proof sets proof_uploaded but never overrides the buyer', async () => {
    const a = await invoice();
    await db.query(
      `insert into delivery_proofs (org_id, invoice_id, path, mime, size_bytes, delivered_on) values ($1, $2, $3, 'image/png', 1000, '2026-10-03')`,
      [orgId, a, `${orgId}/${a}/p.png`],
    );
    expect((await inv(a)).acceptance_source).toBe('proof_uploaded');
    const b = await invoice();
    await extra(await token(b), 'received', { date: '2026-10-06' });
    await db.query(
      `insert into delivery_proofs (org_id, invoice_id, path, mime, size_bytes, delivered_on) values ($1, $2, $3, 'image/png', 1000, '2026-10-02')`,
      [orgId, b, `${orgId}/${b}/p.png`],
    );
    expect((await inv(b)).acceptance_source).toBe('buyer_confirmed');
  });
  it('proof rows reject files over 5 MB and other types', async () => {
    const a = await invoice();
    await expect(
      db.query(
        `insert into delivery_proofs (org_id, invoice_id, path, mime, size_bytes, delivered_on) values ($1, $2, $3, 'image/png', 5242881, '2026-10-02')`,
        [orgId, a, `${orgId}/${a}/big.png`],
      ),
    ).rejects.toThrow();
    await expect(
      db.query(
        `insert into delivery_proofs (org_id, invoice_id, path, mime, size_bytes, delivered_on) values ($1, $2, $3, 'text/html', 10, '2026-10-02')`,
        [orgId, a, `${orgId}/${a}/x.html`],
      ),
    ).rejects.toThrow();
  });
  it('an assumed delivery date never replaces a stronger source', async () => {
    const a = await invoice();
    await db.query('select public.record_assumed_delivery($1, $2)', [a, '2026-10-02']);
    expect((await inv(a)).acceptance_source).toBe('assumed_delivery_date');
    await extra(await token(a), 'received', { date: '2026-10-04' });
    await expect(
      db.query('select public.record_assumed_delivery($1, $2)', [a, '2026-10-02']),
    ).rejects.toThrow(/already/);
  });
});

describe('instalments', () => {
  const items = (d: [string, number][]) => ({
    items: d.map(([date, amount_paise]) => ({ date, amount_paise })),
  });
  const today = async () =>
    (await db.query<{ d: string }>(`select ((now() at time zone 'Asia/Kolkata')::date)::text as d`))
      .rows[0]!.d;
  const plus = async (n: number) =>
    (
      await db.query<{ d: string }>(
        `select ((now() at time zone 'Asia/Kolkata')::date + $1::int)::text as d`,
        [n],
      )
    ).rows[0]!.d;

  it('validates count, dates, gaps and the sum', async () => {
    const id = await invoice({ total: 100000 });
    const t = await token(id);
    await expect(extra(t, 'instalments', items([[await plus(10), 100000]]))).rejects.toThrow(
      /2 to 4/,
    );
    await expect(
      extra(
        t,
        'instalments',
        items([
          [await plus(10), 50000],
          [await plus(12), 50000],
        ]),
      ),
    ).rejects.toThrow(/7 days/);
    await expect(
      extra(
        t,
        'instalments',
        items([
          [await plus(10), 50000],
          [await plus(120), 50000],
        ]),
      ),
    ).rejects.toThrow(/90 days/);
    await expect(
      extra(
        t,
        'instalments',
        items([
          [await plus(10), 50000],
          [await plus(30), 40000],
        ]),
      ),
    ).rejects.toThrow(/add up/);
    expect(await today()).toBeTruthy();
  });
  it('approval creates promises that reconcile with the plan, once', async () => {
    const id = await invoice({ total: 100001 });
    const t = await token(id);
    const plan = (
      await extra(
        t,
        'instalments',
        items([
          [await plus(10), 33334],
          [await plus(20), 33334],
          [await plus(30), 33333],
        ]),
      )
    ).rows[0]!.id;
    await expect(
      extra(
        t,
        'instalments',
        items([
          [await plus(10), 50000],
          [await plus(30), 50001],
        ]),
      ),
    ).rejects.toThrow(/already/);
    const view = (
      await db.query<{ v: { plan: { status: string; items: unknown[] } } }>(
        'select public.pay_extra_view($1) as v',
        [t],
      )
    ).rows[0]!.v;
    expect(view.plan).toMatchObject({ status: 'requested' });
    expect(view.plan.items).toHaveLength(3);
    await db.query('select public.decide_instalment_plan($1, $2, true)', [orgId, plan]);
    const promises = await db.query<{ n: string; s: string }>(
      `select count(*)::text n, sum(promised_amount_paise)::text s from promises where invoice_id = $1 and status = 'open'`,
      [id],
    );
    expect(promises.rows[0]).toEqual({ n: '3', s: '100001' });
    await expect(
      db.query('select public.decide_instalment_plan($1, $2, false)', [orgId, plan]),
    ).rejects.toThrow(/already/);
  });
  it('rejection creates no promises', async () => {
    const id = await invoice({ total: 60000 });
    const plan = (
      await extra(
        await token(id),
        'instalments',
        items([
          [await plus(10), 30000],
          [await plus(20), 30000],
        ]),
      )
    ).rows[0]!.id;
    await db.query('select public.decide_instalment_plan($1, $2, false, $3)', [
      orgId,
      plan,
      'Please pay in full',
    ]);
    expect(
      (await db.query(`select 1 from promises where invoice_id = $1`, [id])).rows,
    ).toHaveLength(0);
  });
});

describe('statement of account', () => {
  it('totals reconcile with the invoices, credit notes, payments and TDS', async () => {
    const c = (
      await db.query<{ id: string }>(
        `insert into customers (org_id, name, state_code) values ($1, 'Stmt Buyer', '27') returning id`,
        [orgId],
      )
    ).rows[0]!.id;
    const mk = async (total: number) =>
      (
        await db.query<{ id: string }>(
          `insert into invoices (org_id, customer_id, number, fy, status, issue_date, due_date, supplier_state_code, place_of_supply, taxable_paise, cgst_paise, sgst_paise, total_paise)
         values ($1, $2, 'S/' || substr(gen_random_uuid()::text, 1, 8), '26-27', 'issued', '2026-09-01', '2026-10-01', '27', '27', $3, 0, 0, $3) returning id`,
          [orgId, c, total],
        )
      ).rows[0]!.id;
    const a = await mk(100000);
    const b = await mk(250000);
    await mk(70000);
    const pay = (
      await db.query<{ id: string }>(
        `insert into payments (org_id, customer_id, amount_paise, received_on) values ($1, $2, 40000, '2026-10-10') returning id`,
        [orgId, c],
      )
    ).rows[0]!.id;
    await db.query(
      `insert into allocations (org_id, payment_id, invoice_id, amount_paise) values ($1, $2, $3, 40000)`,
      [orgId, pay, a],
    );
    await db.query(
      `insert into tds_entries (org_id, customer_id, invoice_id, section, rate, amount_paise, deducted_on) values ($1, $2, $3, '194C', 2, 5000, '2026-10-10')`,
      [orgId, c, b],
    );
    await db.query(
      `insert into notes (org_id, invoice_id, note_type, number, issue_date, total_paise, status) values ($1, $2, 'credit', 'CN/' || substr(gen_random_uuid()::text, 1, 8), '2026-10-12', 10000, 'issued')`,
      [orgId, b],
    );
    const tok = (
      await db.query<{ t: string }>(`select public.create_statement_token($1) as t`, [c])
    ).rows[0]!.t;
    const s = (
      await db.query<{ v: Record<string, any> }>('select public.statement_view($1) as v', [tok])
    ).rows[0]!.v;
    const sum = (k: string) =>
      s[k].reduce((x: number, r: { amount_paise: number }) => x + r.amount_paise, 0);
    const invTotal = s.invoices.reduce(
      (x: number, r: { total_paise: number }) => x + r.total_paise,
      0,
    );
    expect(invTotal - sum('credit_notes') - sum('payments') - sum('tds')).toBe(s.balance_paise);
    expect(s.balance_paise).toBe(420000 - 40000 - 5000 - 10000);
    expect(s.balance_paise).toBe(
      s.invoices.reduce((x: number, r: { balance_paise: number }) => x + r.balance_paise, 0),
    );
    expect(JSON.stringify(s)).not.toContain(orgId);

    await db.query('select public.statement_action($1, $2, $3::jsonb)', [tok, 'confirm', '{}']);
    await db.query('select public.statement_action($1, $2, $3::jsonb)', [
      tok,
      'dispute_line',
      JSON.stringify({ invoice_id: a, reason: 'Not received' }),
    ]);
    const rs = await db.query<{ kind: string; balance_paise: string }>(
      'select kind, balance_paise::text from statement_responses where customer_id = $1 order by created_at',
      [c],
    );
    expect(rs.rows.map((r) => r.kind)).toEqual(['confirmed', 'disputed_line']);
    expect(rs.rows[0]!.balance_paise).toBe('365000');
    expect(
      (await db.query(`select 1 from disputes where invoice_id = $1 and status = 'open'`, [a]))
        .rows,
    ).toHaveLength(1);
    await expect(
      db.query('select public.statement_action($1, $2, $3::jsonb)', [
        tok,
        'dispute_line',
        JSON.stringify({ invoice_id: await invoice(), reason: 'x' }),
      ]),
    ).rejects.toThrow(/not on this statement/);
    expect(
      (await db.query('select public.statement_view($1) as v', ['bogus'])).rows[0],
    ).toMatchObject({ v: null });
  });
});
