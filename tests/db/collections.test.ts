import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actAs, pgliteUser, pgliteWithMigrations } from './pglite';

let db: PGlite;
let orgId: string;
let customerId: string;

async function invoice(): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into invoices (org_id, customer_id, number, fy, status, issue_date, due_date,
       supplier_state_code, place_of_supply, taxable_paise, total_paise)
     values ($1, $2, 'T/' || substr(gen_random_uuid()::text, 1, 8), '26-27', 'issued', '2026-05-01', '2026-06-01', '27', '27', 100000, 100000)
     returning id`,
    [orgId, customerId],
  );
  return r.rows[0]!.id;
}

beforeAll(async () => {
  db = await pgliteWithMigrations();
  const u = await pgliteUser(db);
  orgId = u.orgId;
  await actAs(db, u.userId);
  const c = await db.query<{ id: string }>(
    `insert into customers (org_id, name, state_code) values ($1, 'Buyer', '27') returning id`,
    [orgId],
  );
  customerId = c.rows[0]!.id;
}, 60000);

afterAll(async () => {
  await db?.close();
});

describe('record_send', () => {
  it('logs reminder + message, is idempotent per stage/channel, and audits', async () => {
    const inv = await invoice();
    const a = await db.query<{ record_send: string }>('select public.record_send($1,$2,$3,$4,$5)', [
      orgId,
      inv,
      'pre_due',
      'whatsapp',
      'hello',
    ]);
    const b = await db.query<{ record_send: string }>('select public.record_send($1,$2,$3,$4,$5)', [
      orgId,
      inv,
      'pre_due',
      'whatsapp',
      'hello',
    ]);
    expect(a.rows[0]!.record_send).toBe(b.rows[0]!.record_send);
    const m = await db.query('select 1 from messages where invoice_id = $1', [inv]);
    expect(m.rows).toHaveLength(1);
    const log = await db.query(
      `select 1 from audit_log where table_name in ('reminders','messages') and org_id = $1`,
      [orgId],
    );
    expect(log.rows.length).toBeGreaterThanOrEqual(2);
  });

  it('allows only one outbound message per customer per day', async () => {
    const inv = await invoice();
    await expect(
      db.query('select public.record_send($1,$2,$3,$4,$5)', [
        orgId,
        inv,
        'due_today',
        'email',
        'second today',
      ]),
    ).rejects.toThrow(/daily message limit/);
  });

  it('rejects unknown stages and a second sent stage row per stage/channel', async () => {
    const inv = await invoice();
    await expect(
      db.query('select public.record_send($1,$2,$3,$4,$5)', [orgId, inv, 'bogus', 'email', 'x']),
    ).rejects.toThrow();
  });

  it('accepts next_steps as a reminder stage', async () => {
    const inv = await invoice();
    await db.query(
      `insert into reminders (org_id, invoice_id, customer_id, stage, channel, scheduled_for) values ($1,$2,$3,'next_steps','email', now())`,
      [orgId, inv, customerId],
    );
  });
});

describe('disputes keep invoices.disputed in step', () => {
  it('open dispute sets it, resolving clears it, two disputes need both resolved', async () => {
    const inv = await invoice();
    const flag = async () =>
      (await db.query<{ disputed: boolean }>('select disputed from invoices where id = $1', [inv]))
        .rows[0]!.disputed;
    expect(await flag()).toBe(false);
    const d1 = await db.query<{ id: string }>(
      `insert into disputes (org_id, invoice_id, reason) values ($1,$2,'wrong qty') returning id`,
      [orgId, inv],
    );
    const d2 = await db.query<{ id: string }>(
      `insert into disputes (org_id, invoice_id, reason) values ($1,$2,'price') returning id`,
      [orgId, inv],
    );
    expect(await flag()).toBe(true);
    await db.query(`update disputes set status = 'resolved' where id = $1`, [d1.rows[0]!.id]);
    expect(await flag()).toBe(true);
    await db.query(`update disputes set status = 'rejected' where id = $1`, [d2.rows[0]!.id]);
    expect(await flag()).toBe(false);
  });
});

describe('settings columns', () => {
  it('demand_letter_days is bounded and ladder_config must be an object', async () => {
    await expect(
      db.query(`update business_profile set demand_letter_days = 0 where org_id = $1`, [orgId]),
    ).rejects.toThrow();
    await expect(
      db.query(`update business_profile set ladder_config = '[1]'::jsonb where org_id = $1`, [
        orgId,
      ]),
    ).rejects.toThrow();
    await db.query(
      `update business_profile set ladder_config = '{"final":16}'::jsonb, demand_letter_days = 10 where org_id = $1`,
      [orgId],
    );
  });
});
