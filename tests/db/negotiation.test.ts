/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actAs, newUser, openDb } from './harness';

let db: PGlite;
let orgId: string;
let customerId: string;
let tok: string;
let invId: string;

const day = (n: number) =>
  new Date(Date.now() + 5.5 * 3600000 + n * 86400000).toISOString().slice(0, 10);

async function newInvoice(total = 100000) {
  const r = await db.query<{ id: string }>(
    `insert into invoices (org_id, customer_id, number, fy, status, issue_date, due_date,
       supplier_state_code, place_of_supply, taxable_paise, cgst_paise, sgst_paise, total_paise)
     values ($1, $2, 'N/' || substr(gen_random_uuid()::text, 1, 8), '26-27', 'issued', '2026-09-01', '2026-10-01',
       '27', '27', $3, 0, 0, $3) returning id`,
    [orgId, customerId, total],
  );
  const id = r.rows[0]!.id;
  const t = (
    await db.query<{ t: string }>(`select public.create_pay_token($1, interval '60 days') as t`, [
      id,
    ])
  ).rows[0]!.t;
  return { id, t };
}
const apply = async (t: string, tool: string, args: unknown) =>
  (
    await db.query<{ r: any }>('select public.neg_apply($1, $2, $3::jsonb) as r', [
      t,
      tool,
      JSON.stringify(args),
    ])
  ).rows[0]!.r;
const setCfg = (patch: string) =>
  db.query(`update business_profile set ${patch} where org_id = $1`, [orgId]);

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
  const i = await newInvoice();
  tok = i.t;
  invId = i.id;
}, 60000);
afterAll(async () => {
  await db?.close();
});

describe('negotiation limits are enforced in the database', () => {
  it('refuses everything while the owner has it switched off, and logs the refusal', async () => {
    const r = await apply(tok, 'record_promise', { date: day(5) });
    expect(r.ok).toBe(false);
    const log = await db.query(
      `select 1 from negotiation_log where invoice_id = $1 and role = 'tool' and ok = false`,
      [invId],
    );
    expect(log.rows.length).toBe(1);
  });

  it('discount cannot exceed the configured percent', async () => {
    await setCfg('neg_enabled = true, neg_max_discount_pct = 2');
    const bad = await apply(tok, 'offer_early_pay_discount', { pct: 50, pay_by: day(5) });
    expect(bad.ok).toBe(false);
    expect((await apply(tok, 'offer_early_pay_discount', { pct: 2.01, pay_by: day(5) })).ok).toBe(
      false,
    );
    expect((await apply(tok, 'offer_early_pay_discount', { pct: -1, pay_by: day(5) })).ok).toBe(
      false,
    );
    const ok = await apply(tok, 'offer_early_pay_discount', { pct: 2, pay_by: day(5) });
    expect(ok.ok).toBe(true);
    expect(ok.discount_paise).toBe(2000);
    expect(ok.pay_paise).toBe(98000);
    const offers = await db.query(
      `select 1 from discount_offers where invoice_id = $1 and status = 'offered'`,
      [invId],
    );
    expect(offers.rows.length).toBe(1);
  });

  it('discount deadline must be soon; garbage input is a refusal, not an error', async () => {
    expect((await apply(tok, 'offer_early_pay_discount', { pct: 1, pay_by: day(60) })).ok).toBe(
      false,
    );
    expect((await apply(tok, 'offer_early_pay_discount', { pct: 'abc', pay_by: 'x' })).ok).toBe(
      false,
    );
  });

  it('promise date and amount are bounded', async () => {
    await setCfg('neg_max_promise_days = 30');
    expect((await apply(tok, 'record_promise', { date: day(31) })).ok).toBe(false);
    expect((await apply(tok, 'record_promise', { date: day(-1) })).ok).toBe(false);
    expect((await apply(tok, 'record_promise', { date: day(10), amount_paise: 100001 })).ok).toBe(
      false,
    );
    expect((await apply(tok, 'record_promise', { date: day(10), amount_paise: 0 })).ok).toBe(false);
    const ok = await apply(tok, 'record_promise', { date: day(30), amount_paise: 50000 });
    expect(ok.ok).toBe(true);
    const p = await db.query<{ promised_amount_paise: string }>(
      `select promised_amount_paise from promises where invoice_id = $1`,
      [invId],
    );
    expect(Number(p.rows[0]!.promised_amount_paise)).toBe(50000);
  });

  it('instalments: count, window and total are controlled by the server', async () => {
    await setCfg('neg_max_instalments = 3, neg_max_promise_days = 30');
    const i = await newInvoice(100001);
    expect((await apply(i.t, 'offer_instalments', { count: 4, first_date: day(1) })).ok).toBe(
      false,
    );
    expect((await apply(i.t, 'offer_instalments', { count: 1, first_date: day(1) })).ok).toBe(
      false,
    );
    // 3 instalments every 14 days starting in 20 days ends on day 48, beyond 30
    expect((await apply(i.t, 'offer_instalments', { count: 3, first_date: day(20) })).ok).toBe(
      false,
    );
    const ok = await apply(i.t, 'offer_instalments', { count: 3, first_date: day(2) });
    expect(ok.ok).toBe(true);
    const sum = (ok.items as { amount_paise: number }[]).reduce((s, x) => s + x.amount_paise, 0);
    expect(sum).toBe(100001);
    expect((await apply(i.t, 'offer_instalments', { count: 2, first_date: day(2) })).ok).toBe(
      false,
    );
    const plan = await db.query<{ status: string }>(
      `select status from instalment_plans where invoice_id = $1`,
      [i.id],
    );
    expect(plan.rows[0]!.status).toBe('requested');
  });

  it('dispute needs a reason, pauses via the dispute flag; facts are read only', async () => {
    const i = await newInvoice();
    expect((await apply(i.t, 'raise_dispute', { reason: '  ' })).ok).toBe(false);
    expect((await apply(i.t, 'raise_dispute', { reason: 'Goods not received' })).ok).toBe(true);
    const flag = await db.query<{ disputed: boolean }>(
      `select disputed from invoices where id = $1`,
      [i.id],
    );
    expect(flag.rows[0]!.disputed).toBe(true);
    const f = await apply(i.t, 'answer_invoice_question', { topic: 'balance' });
    expect(f.ok).toBe(true);
    expect(f.balance_paise).toBe(100000);
  });

  it('an unknown tool is refused and a bad token raises', async () => {
    expect((await apply(tok, 'delete_invoice', {})).ok).toBe(false);
    await expect(apply('x'.repeat(40), 'record_promise', { date: day(1) })).rejects.toThrow(
      /invalid or expired/,
    );
  });

  it('every tool call is in negotiation_log and in audit_log', async () => {
    const n = await db.query<{ c: string }>(
      `select count(*) c from negotiation_log where role = 'tool'`,
    );
    expect(Number(n.rows[0]!.c)).toBeGreaterThan(10);
    const a = await db.query(
      `select 1 from audit_log where table_name = 'negotiation_log' limit 1`,
    );
    expect(a.rows.length).toBe(1);
  });
});
