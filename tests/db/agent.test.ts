import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actAs, newUser, openDb } from './harness';

let db: PGlite;
let orgId: string;
let customerId: string;
let invoiceId: string;

beforeAll(async () => {
  db = await openDb();
  const u = await newUser(db);
  orgId = u.orgId;
  await actAs(db, u.userId);
  customerId = (
    await db.query<{ id: string }>(
      `insert into customers (org_id, name, state_code) values ($1, 'Agent buyer', '27') returning id`,
      [orgId],
    )
  ).rows[0]!.id;
  invoiceId = (
    await db.query<{ id: string }>(
      `insert into invoices (org_id, customer_id, number, fy, status, issue_date, due_date,
         supplier_state_code, place_of_supply, taxable_paise, cgst_paise, sgst_paise, total_paise)
       values ($1, $2, 'INV/26-27/0001', '26-27', 'issued', '2026-09-01', '2026-10-01', '27', '27', 100000, 9000, 9000, 118000) returning id`,
      [orgId, customerId],
    )
  ).rows[0]!.id;
}, 60000);

afterAll(async () => {
  await db?.close();
});

const action = (status: string, day = '2026-10-24', stage = 'final') =>
  db.query(
    `insert into agent_actions (org_id, invoice_id, customer_id, action_type, stage, status, run_date)
     values ($1, $2, $3, 'send_reminder', $4, $5, $6)`,
    [orgId, invoiceId, customerId, stage, status, day],
  );

describe('agent tables', () => {
  it('defaults: L0, test mode on, quiet hours 21-9, both channels', async () => {
    const r = await db.query(
      `select autonomy_level, test_mode, quiet_start_hour, quiet_end_hour, channels, demo_date from business_profile where org_id = $1`,
      [orgId],
    );
    expect(r.rows[0]).toMatchObject({
      autonomy_level: 0,
      test_mode: true,
      quiet_start_hour: 21,
      quiet_end_hour: 9,
      channels: ['email', 'whatsapp'],
      demo_date: null,
    });
  });

  it('rejects out-of-range autonomy and unknown channels', async () => {
    await expect(
      db.query(`update business_profile set autonomy_level = 3 where org_id = $1`, [orgId]),
    ).rejects.toThrow();
    await expect(
      db.query(`update business_profile set channels = array['sms'] where org_id = $1`, [orgId]),
    ).rejects.toThrow();
  });

  it('accepts the new statuses and rejects old or unknown ones', async () => {
    for (const s of ['proposed', 'approved', 'sent', 'failed', 'skipped', 'rejected']) {
      await action(
        s,
        `2026-11-0${['proposed', 'approved', 'sent', 'failed', 'skipped', 'rejected'].indexOf(s) + 1}`,
      );
    }
    await expect(action('executed', '2026-12-01')).rejects.toThrow();
  });

  it('planning the same invoice, stage and day twice is blocked (idempotent planner)', async () => {
    await action('proposed', '2026-10-24', 'due_today');
    await expect(action('proposed', '2026-10-24', 'due_today')).rejects.toThrow(
      /agent_actions_plan_uq|duplicate/,
    );
    await action('proposed', '2026-10-25', 'due_today');
  });

  it('keeps a decision log with the approver', async () => {
    await db.query(
      `update agent_actions set status = 'approved', approver = 'owner:abc',
         decision_log = decision_log || '[{"by":"owner:abc","decision":"approved"}]'::jsonb
       where org_id = $1 and stage = 'due_today' and run_date = '2026-10-24'`,
      [orgId],
    );
    const r = await db.query<{ approver: string; decision_log: { by: string }[] }>(
      `select approver, decision_log from agent_actions where org_id = $1 and stage = 'due_today' and run_date = '2026-10-24'`,
      [orgId],
    );
    expect(r.rows[0]!.approver).toBe('owner:abc');
    expect(r.rows[0]!.decision_log[0]!.by).toBe('owner:abc');
  });

  it('agent_runs starts empty for a new org (client writes are blocked by the isolation suite)', async () => {
    const r = await db.query(`select count(*)::int as n from agent_runs where org_id = $1`, [
      orgId,
    ]);
    expect(r.rows[0]).toMatchObject({ n: 0 });
  });
});
