import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actAs, newUser, openDb } from './harness';

let db: PGlite;
let orgId: string;
let customerId: string;

beforeAll(async () => {
  db = await openDb();
  const u = await newUser(db);
  orgId = u.orgId;
  await actAs(db, u.userId);
  customerId = (
    await db.query<{ id: string }>(
      `insert into customers (org_id, name, state_code) values ($1, 'Hist buyer', '27') returning id`,
      [orgId],
    )
  ).rows[0]!.id;
}, 60000);

afterAll(async () => {
  await db?.close();
});

describe('forecast settings and expenses', () => {
  it('opening balance, date and buffer are stored; negative buffer is rejected', async () => {
    await db.query(
      `update business_profile set opening_balance_paise = 123456700, opening_balance_on = '2026-10-26', safety_buffer_paise = 5000000 where org_id = $1`,
      [orgId],
    );
    const r = await db.query<{ opening_balance_paise: number; safety_buffer_paise: number }>(
      'select opening_balance_paise, safety_buffer_paise from business_profile where org_id = $1',
      [orgId],
    );
    expect(r.rows[0]).toMatchObject({
      opening_balance_paise: 123456700,
      safety_buffer_paise: 5000000,
    });
    await expect(
      db.query(`update business_profile set safety_buffer_paise = -1 where org_id = $1`, [orgId]),
    ).rejects.toThrow();
  });
  it('expenses take a kind and a deferrable flag; unknown kinds are rejected', async () => {
    await db.query(
      `insert into expenses (org_id, name, kind, amount_paise, expense_date, is_recurring, recurrence, next_due, can_defer)
       values ($1, 'Salaries', 'salary', 24000000, '2026-11-01', true, 'monthly', '2026-11-01', false),
              ($1, 'Steel bill', 'supplier', 8000000, '2026-11-10', false, null, null, true)`,
      [orgId],
    );
    const r = await db.query<{ name: string; can_defer: boolean }>(
      'select name, can_defer from expenses where org_id = $1 order by name',
      [orgId],
    );
    expect(r.rows.map((x) => [x.name, x.can_defer])).toEqual([
      ['Salaries', false],
      ['Steel bill', true],
    ]);
    await expect(
      db.query(
        `insert into expenses (org_id, name, kind, amount_paise, expense_date) values ($1, 'x', 'bogus', 1, '2026-11-01')`,
        [orgId],
      ),
    ).rejects.toThrow();
  });
});

describe('invoice_settlements view', () => {
  it('has one row per payment applied to an invoice, with due date and totals', async () => {
    const inv = (
      await db.query<{ id: string }>(
        `insert into invoices (org_id, customer_id, number, fy, status, issue_date, due_date, supplier_state_code, place_of_supply,
           taxable_paise, total_paise) values ($1, $2, 'H/0001', '26-27', 'issued', '2026-08-01', '2026-08-31', '27', '27', 100000, 100000) returning id`,
        [orgId, customerId],
      )
    ).rows[0]!.id;
    const pay = async (amount: number, on: string) =>
      (
        await db.query<{ id: string }>(
          `insert into payments (org_id, customer_id, amount_paise, received_on) values ($1, $2, $3, $4) returning id`,
          [orgId, customerId, amount, on],
        )
      ).rows[0]!.id;
    const p1 = await pay(40000, '2026-09-05');
    const p2 = await pay(60000, '2026-09-20');
    await db.query(
      `insert into allocations (org_id, payment_id, invoice_id, amount_paise) values ($1, $2, $3, 40000), ($1, $4, $3, 60000)`,
      [orgId, p1, inv, p2],
    );
    const r = await db.query<{
      event_date: string;
      event_paise: number;
      total_paise: number;
      due_date: string;
    }>(
      `select event_date::text, event_paise, total_paise, due_date::text from invoice_settlements where invoice_id = $1 order by event_date`,
      [inv],
    );
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({
      event_date: '2026-09-05',
      event_paise: 40000,
      total_paise: 100000,
      due_date: '2026-08-31',
    });
    expect(r.rows[1]).toMatchObject({ event_date: '2026-09-20', event_paise: 60000 });
  });
  it('failed or pending payments are not settlements', async () => {
    const inv = (
      await db.query<{ id: string }>(
        `insert into invoices (org_id, customer_id, number, fy, status, issue_date, due_date, supplier_state_code, place_of_supply,
           taxable_paise, total_paise) values ($1, $2, 'H/0002', '26-27', 'issued', '2026-08-01', '2026-08-31', '27', '27', 5000, 5000) returning id`,
        [orgId, customerId],
      )
    ).rows[0]!.id;
    const p = (
      await db.query<{ id: string }>(
        `insert into payments (org_id, customer_id, amount_paise, received_on, status) values ($1, $2, 5000, '2026-09-01', 'pending') returning id`,
        [orgId, customerId],
      )
    ).rows[0]!.id;
    await db.query(
      `insert into allocations (org_id, payment_id, invoice_id, amount_paise) values ($1, $2, $3, 5000)`,
      [orgId, p, inv],
    );
    const r = await db.query('select 1 from invoice_settlements where invoice_id = $1', [inv]);
    expect(r.rows).toHaveLength(0);
  });
});
