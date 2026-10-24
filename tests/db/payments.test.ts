import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actAs, pgliteUser, pgliteWithMigrations } from './pglite';

let db: PGlite;
let orgId: string;
let customerId: string;

async function invoice(total = 118000): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into invoices (org_id, customer_id, number, fy, status, issue_date, due_date,
       supplier_state_code, place_of_supply, taxable_paise, cgst_paise, sgst_paise, total_paise)
     values ($1, $2, 'T/' || substr(gen_random_uuid()::text, 1, 8), '26-27', 'issued', '2026-05-01', '2026-06-01',
       '27', '27', $3, 0, 0, $3)
     returning id`,
    [orgId, customerId, total],
  );
  return r.rows[0]!.id;
}

async function token(inv: string): Promise<string> {
  const r = await db.query<{ t: string }>(
    `select public.create_pay_token($1, interval '60 days') as t`,
    [inv],
  );
  return r.rows[0]!.t;
}

async function row(inv: string) {
  return (
    await db.query<{
      status: string;
      paid_paise: string;
      balance_paise: string;
      credited_paise: string;
      tds_paise: string;
    }>(
      'select status, paid_paise, balance_paise, credited_paise, tds_paise from invoices where id = $1',
      [inv],
    )
  ).rows[0]!;
}

beforeAll(async () => {
  db = await pgliteWithMigrations();
  const u = await pgliteUser(db);
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

describe('pay view and actions', () => {
  it('a token returns only its own invoice and public fields', async () => {
    const a = await invoice(100000);
    const b = await invoice(250000);
    const ta = await token(a);
    const tb = await token(b);
    const va = (
      await db.query<{ v: Record<string, unknown> }>('select public.pay_view($1) as v', [ta])
    ).rows[0]!.v;
    const vb = (
      await db.query<{ v: Record<string, unknown> }>('select public.pay_view($1) as v', [tb])
    ).rows[0]!.v;
    expect(va.invoice_id).toBe(a);
    expect(vb.invoice_id).toBe(b);
    expect(va.total_paise).toBe(100000);
    expect(JSON.stringify(va)).not.toContain(orgId);
    expect(Object.keys(va)).not.toContain('org_id');
  });
  it('unknown, expired and revoked tokens return null', async () => {
    const a = await invoice();
    const t = await token(a);
    expect((await db.query('select public.pay_view($1) as v', ['nope'])).rows[0]).toMatchObject({
      v: null,
    });
    await db.query(
      `update pay_tokens set expires_at = now() - interval '1 second', created_at = now() - interval '1 day' where invoice_id = $1`,
      [a],
    );
    expect((await db.query('select public.pay_view($1) as v', [t])).rows[0]).toMatchObject({
      v: null,
    });
    const t2 = await token(a);
    await db.query(
      `update pay_tokens set revoked_at = now() where token_hash = encode(extensions.digest($1, 'sha256'), 'hex')`,
      [t2],
    );
    expect((await db.query('select public.pay_view($1) as v', [t2])).rows[0]).toMatchObject({
      v: null,
    });
  });
  it('actions land on the token invoice only: claim, dispute (sets flag), promise', async () => {
    const a = await invoice();
    const other = await invoice();
    const t = await token(a);
    await db.query(
      `select public.pay_action($1, 'paid', '{"reference":"UTR1","paid_on":"2026-06-02"}'::jsonb)`,
      [t],
    );
    await db.query(
      `select public.pay_action($1, 'dispute', '{"reason":"wrong qty","note":"3 not 5"}'::jsonb)`,
      [t],
    );
    await db.query(
      `select public.pay_action($1, 'promise', jsonb_build_object('date', (current_date + 5)::text))`,
      [t],
    );
    expect(
      (await db.query('select 1 from payment_claims where invoice_id = $1', [a])).rows,
    ).toHaveLength(1);
    expect(
      (
        await db.query('select 1 from disputes where invoice_id = $1 and raised_via = $2', [
          a,
          'portal',
        ])
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await db.query('select 1 from promises where invoice_id = $1 and source = $2', [
          a,
          'portal',
        ])
      ).rows,
    ).toHaveLength(1);
    for (const tbl of ['payment_claims', 'disputes', 'promises']) {
      expect(
        (await db.query(`select 1 from ${tbl} where invoice_id = $1`, [other])).rows,
      ).toHaveLength(0);
    }
    expect(
      (await db.query<{ disputed: boolean }>('select disputed from invoices where id = $1', [a]))
        .rows[0]!.disputed,
    ).toBe(true);
  });
  it('rejects bad input and bad tokens', async () => {
    const t = await token(await invoice());
    await expect(
      db.query(`select public.pay_action($1, 'dispute', '{"reason":" "}'::jsonb)`, [t]),
    ).rejects.toThrow(/reason/);
    await expect(
      db.query(`select public.pay_action($1, 'paid', '{"paid_on":"2999-01-01"}'::jsonb)`, [t]),
    ).rejects.toThrow(/date/);
    await expect(
      db.query(`select public.pay_action($1, 'promise', '{"date":"2020-01-01"}'::jsonb)`, [t]),
    ).rejects.toThrow(/promise date/);
    await expect(
      db.query(`select public.pay_action('bad', 'promise', '{}'::jsonb)`),
    ).rejects.toThrow(/invalid or expired/);
    await expect(
      db.query(`select public.pay_action($1, 'other', '{}'::jsonb)`, [t]),
    ).rejects.toThrow(/unknown action/);
  });
});

describe('rate limit', () => {
  it('allows max hits per window then blocks, and resets after the window', async () => {
    const hits: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      hits.push(
        (await db.query<{ ok: boolean }>(`select public.rate_limit_hit('ip:1.2.3.4', 3, 60) as ok`))
          .rows[0]!.ok,
      );
    }
    expect(hits).toEqual([true, true, true, false]);
    await db.query(
      `update rate_limits set window_start = now() - interval '2 minutes' where key = 'ip:1.2.3.4'`,
    );
    expect(
      (await db.query<{ ok: boolean }>(`select public.rate_limit_hit('ip:1.2.3.4', 3, 60) as ok`))
        .rows[0]!.ok,
    ).toBe(true);
  });
});

describe('gateway payments', () => {
  it('records payment + allocation + audit, marks invoice paid, and is idempotent per gateway payment id', async () => {
    const a = await invoice(50000);
    const r1 = (
      await db.query<{ r: { duplicate: boolean; allocated_paise: number } }>(
        `select public.record_gateway_payment($1, 50000, 'pay_TEST1') as r`,
        [a],
      )
    ).rows[0]!.r;
    const r2 = (
      await db.query<{ r: { duplicate: boolean } }>(
        `select public.record_gateway_payment($1, 50000, 'pay_TEST1') as r`,
        [a],
      )
    ).rows[0]!.r;
    expect(r1.duplicate).toBe(false);
    expect(r1.allocated_paise).toBe(50000);
    expect(r2.duplicate).toBe(true);
    expect(
      (await db.query('select 1 from payments where razorpay_payment_id = $1', ['pay_TEST1'])).rows,
    ).toHaveLength(1);
    expect(
      (await db.query('select 1 from allocations where invoice_id = $1', [a])).rows,
    ).toHaveLength(1);
    expect(await row(a)).toMatchObject({ status: 'paid', balance_paise: 0 });
    const log = await db.query(
      `select 1 from audit_log where table_name in ('payments','allocations') and org_id = $1`,
      [orgId],
    );
    expect(log.rows.length).toBeGreaterThanOrEqual(2);
  });
  it('a payment bigger than the balance only allocates the balance', async () => {
    const a = await invoice(10000);
    const r = (
      await db.query<{ r: { allocated_paise: number; unallocated_paise: number } }>(
        `select public.record_gateway_payment($1, 15000, 'pay_TEST2') as r`,
        [a],
      )
    ).rows[0]!.r;
    expect(r).toMatchObject({ allocated_paise: 10000, unallocated_paise: 5000 });
  });
  it('part payment keeps the invoice open with the right balance', async () => {
    const a = await invoice(10000);
    await db.query(`select public.record_gateway_payment($1, 4000, 'pay_TEST3')`, [a]);
    expect(await row(a)).toMatchObject({
      status: 'partially_paid',
      paid_paise: 4000,
      balance_paise: 6000,
    });
  });
});

describe('credit notes reduce the balance', () => {
  it('issued credit note lowers balance, voiding restores it, part credit + payment closes it', async () => {
    const a = await invoice(100000);
    const n = (
      await db.query<{ id: string }>(
        `insert into notes (org_id, invoice_id, note_type, number, issue_date, taxable_paise, total_paise, status)
       values ($1, $2, 'credit', 'CN/' || substr(gen_random_uuid()::text, 1, 6), '2026-06-05', 30000, 30000, 'issued') returning id`,
        [orgId, a],
      )
    ).rows[0]!.id;
    expect(await row(a)).toMatchObject({
      credited_paise: 30000,
      balance_paise: 70000,
      status: 'issued',
    });
    await db.query(`select public.record_gateway_payment($1, 70000, 'pay_TEST4')`, [a]);
    expect(await row(a)).toMatchObject({ status: 'paid', balance_paise: 0 });
    await db.query(`update notes set status = 'void' where id = $1`, [n]);
    expect(await row(a)).toMatchObject({
      credited_paise: 0,
      balance_paise: 30000,
      status: 'partially_paid',
    });
  });
  it('a draft credit note does not count', async () => {
    const a = await invoice(100000);
    await db.query(
      `insert into notes (org_id, invoice_id, note_type, issue_date, taxable_paise, total_paise, status)
       values ($1, $2, 'credit', '2026-06-05', 30000, 30000, 'draft')`,
      [orgId, a],
    );
    expect(await row(a)).toMatchObject({ credited_paise: 0, balance_paise: 100000 });
  });
});

describe('bank match confirmation', () => {
  async function txn(amount: number): Promise<string> {
    return (
      await db.query<{ id: string }>(
        `insert into bank_txns (org_id, txn_date, description, direction, amount_paise, reference, dedupe_hash)
       values ($1, '2026-06-10', 'NEFT', 'credit', $2, 'R1', gen_random_uuid()::text) returning id`,
        [orgId, amount],
      )
    ).rows[0]!.id;
  }
  it('creates payment + allocation, is idempotent, and marks the line matched', async () => {
    const a = await invoice(100000);
    const t = await txn(100000);
    const alloc = JSON.stringify([{ invoice_id: a, amount_paise: 100000 }]);
    const p1 = (
      await db.query<{ p: string }>(
        'select public.confirm_bank_match($1,$2,$3,$4::jsonb,null) as p',
        [orgId, t, customerId, alloc],
      )
    ).rows[0]!.p;
    const p2 = (
      await db.query<{ p: string }>(
        'select public.confirm_bank_match($1,$2,$3,$4::jsonb,null) as p',
        [orgId, t, customerId, alloc],
      )
    ).rows[0]!.p;
    expect(p1).toBe(p2);
    expect(await row(a)).toMatchObject({ status: 'paid' });
    expect(
      (await db.query<{ status: string }>('select status from bank_txns where id = $1', [t]))
        .rows[0]!.status,
    ).toBe('matched');
  });
  it('short by TDS: deposit + TDS entry settles the invoice and records a pending certificate', async () => {
    const a = await invoice(100000);
    const t = await txn(98000);
    const alloc = JSON.stringify([{ invoice_id: a, amount_paise: 98000 }]);
    const tds = JSON.stringify({
      section: '194C',
      rate: 2,
      amount_paise: 2000,
      invoice_id: a,
      taxable_paise: 100000,
    });
    await db.query('select public.confirm_bank_match($1,$2,$3,$4::jsonb,$5::jsonb)', [
      orgId,
      t,
      customerId,
      alloc,
      tds,
    ]);
    expect(await row(a)).toMatchObject({
      status: 'paid',
      paid_paise: 98000,
      tds_paise: 2000,
      balance_paise: 0,
    });
    const e = (
      await db.query<{ certificate_status: string; financial_year: string }>(
        'select certificate_status, financial_year from tds_entries where invoice_id = $1',
        [a],
      )
    ).rows[0]!;
    expect(e).toMatchObject({ certificate_status: 'pending', financial_year: '26-27' });
  });
  it('rejects allocations above the deposit', async () => {
    const a = await invoice(100000);
    const t = await txn(50000);
    await expect(
      db.query('select public.confirm_bank_match($1,$2,$3,$4::jsonb,null)', [
        orgId,
        t,
        customerId,
        JSON.stringify([{ invoice_id: a, amount_paise: 60000 }]),
      ]),
    ).rejects.toThrow(/exceed/);
  });
});

describe('inbox resolution', () => {
  async function claimFor(inv: string): Promise<string> {
    return (
      await db.query<{ id: string }>(
        `insert into payment_claims (org_id, invoice_id, customer_id, reference, paid_on) values ($1, $2, $3, 'UTR9', '2026-06-02') returning id`,
        [orgId, inv, customerId],
      )
    ).rows[0]!.id;
  }
  it('accepting a claim records the payment and marks the invoice paid; resolving twice is a no-op', async () => {
    const a = await invoice(40000);
    const c = await claimFor(a);
    await db.query('select public.resolve_claim($1, $2, true, $3)', [orgId, c, 'Thanks, received']);
    await db.query('select public.resolve_claim($1, $2, true, $3)', [orgId, c, 'again']);
    expect(await row(a)).toMatchObject({ status: 'paid', balance_paise: 0 });
    expect(
      (
        await db.query('select 1 from payments where reference = $1 and received_on = $2', [
          'UTR9',
          '2026-06-02',
        ])
      ).rows.length,
    ).toBeGreaterThanOrEqual(1);
    const st = (
      await db.query<{ status: string; owner_reply: string }>(
        'select status, owner_reply from payment_claims where id = $1',
        [c],
      )
    ).rows[0]!;
    expect(st).toMatchObject({ status: 'accepted', owner_reply: 'Thanks, received' });
  });
  it('rejecting a claim needs a reply and leaves the invoice open', async () => {
    const a = await invoice(40000);
    const c = await claimFor(a);
    await expect(
      db.query('select public.resolve_claim($1, $2, false, $3)', [orgId, c, ' ']),
    ).rejects.toThrow(/reply/);
    await db.query('select public.resolve_claim($1, $2, false, $3)', [orgId, c, 'Not in our bank']);
    expect(await row(a)).toMatchObject({ status: 'issued', balance_paise: 40000 });
  });
  it('dispute outcomes: rejected needs a reply, paid closes the invoice, flag clears when resolved', async () => {
    const a = await invoice(40000);
    const d = (
      await db.query<{ id: string }>(
        `insert into disputes (org_id, invoice_id, reason) values ($1, $2, 'wrong') returning id`,
        [orgId, a],
      )
    ).rows[0]!.id;
    const flag = async () =>
      (await db.query<{ disputed: boolean }>('select disputed from invoices where id = $1', [a]))
        .rows[0]!.disputed;
    expect(await flag()).toBe(true);
    await expect(
      db.query(`select public.resolve_dispute($1, $2, 'rejected', '')`, [orgId, d]),
    ).rejects.toThrow(/reply/);
    await expect(
      db.query(`select public.resolve_dispute($1, $2, 'bogus', 'x')`, [orgId, d]),
    ).rejects.toThrow(/outcome/);
    await db.query(`select public.resolve_dispute($1, $2, 'paid', 'settled')`, [orgId, d]);
    expect(await flag()).toBe(false);
    expect(await row(a)).toMatchObject({ status: 'paid' });
    const b = await invoice(40000);
    const d2 = (
      await db.query<{ id: string }>(
        `insert into disputes (org_id, invoice_id, reason) values ($1, $2, 'wrong') returning id`,
        [orgId, b],
      )
    ).rows[0]!.id;
    await db.query(
      `select public.resolve_dispute($1, $2, 'rejected', 'The goods were delivered')`,
      [orgId, d2],
    );
    const v = (
      await db.query<{ v: { replies: string[]; open_dispute: boolean } }>(
        'select public.pay_view($1) as v',
        [await token(b)],
      )
    ).rows[0]!.v;
    expect(v.replies).toContain('The goods were delivered');
    expect(v.open_dispute).toBe(false);
  });
  it('manual payment is capped at the balance for allocation', async () => {
    const a = await invoice(10000);
    await db.query(`select public.record_manual_payment($1, $2, 15000, 'cash', null, null)`, [
      orgId,
      a,
    ]);
    expect(await row(a)).toMatchObject({ status: 'paid', paid_paise: 10000 });
  });
});
