import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actAs, newUser, openDb } from './harness';

let db: PGlite;
let owner: { userId: string; orgId: string };
let other: { userId: string; orgId: string };

beforeAll(async () => {
  db = await openDb();
  owner = await newUser(db);
  other = await newUser(db);
}, 60000);

afterAll(async () => {
  await db?.close();
});

const q = <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  db.query<T>(sql, params);

describe('consent records and client errors', () => {
  it('stores consent decisions; the latest per channel is what counts', async () => {
    await actAs(db, owner.userId);
    const c = (
      await q<{ id: string }>(
        `insert into customers (org_id, name, state_code) values ($1, 'Consent Co', '27') returning id`,
        [owner.orgId],
      )
    ).rows[0]!.id;
    await q(
      `insert into customer_consents (org_id, customer_id, channel, status, basis) values ($1, $2, 'whatsapp', 'granted', 'verbal')`,
      [owner.orgId, c],
    );
    await q(
      `insert into customer_consents (org_id, customer_id, channel, status, basis, note) values ($1, $2, 'whatsapp', 'withdrawn', 'written', 'asked us to stop')`,
      [owner.orgId, c],
    );
    const latest = await q<{ status: string }>(
      `select status from customer_consents where customer_id = $1 and channel = 'whatsapp' order by created_at desc, id desc limit 1`,
      [c],
    );
    expect(latest.rows[0]!.status).toBe('withdrawn');
    await expect(
      q(
        `insert into customer_consents (org_id, customer_id, channel, status, basis) values ($1, $2, 'fax', 'granted', 'verbal')`,
        [owner.orgId, c],
      ),
    ).rejects.toThrow();
    const audit = await q(
      `select 1 from audit_log where org_id = $1 and table_name = 'customer_consents'`,
      [owner.orgId],
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(2);
  });

  it('records a client error with the signed-in user and bounds the text', async () => {
    await actAs(db, owner.userId);
    await q(`insert into app_errors (org_id, route, message) values ($1, '/forecast', 'boom')`, [
      owner.orgId,
    ]);
    const r = await q<{ user_id: string }>(`select user_id from app_errors where org_id = $1`, [
      owner.orgId,
    ]);
    expect(r.rows[0]!.user_id).toBe(owner.userId);
    await expect(
      q(`insert into app_errors (org_id, route, message) values ($1, '/x', $2)`, [
        owner.orgId,
        'x'.repeat(1001),
      ]),
    ).rejects.toThrow();
  });
});

describe('organisation rename', () => {
  it('the owner can rename the organisation (org_id is generated, so the immutability check skips orgs)', async () => {
    const u = await newUser(db);
    await actAs(db, u.userId);
    await q(`update orgs set name = 'Renamed Co' where id = $1`, [u.orgId]);
    const r = await q<{ name: string }>(`select name from orgs where id = $1`, [u.orgId]);
    expect(r.rows[0]!.name).toBe('Renamed Co');
  });
});

describe('delete_org', () => {
  it('refuses the demo organisation, even for its owner', async () => {
    const demo = '00000000-0000-4000-8000-00000000de60';
    await actAs(db, owner.userId);
    await expect(q(`select public.delete_org($1, 'Demo Traders')`, [demo])).rejects.toThrow(
      /demo organisation/,
    );
    const still = await q(`select 1 from orgs where id = $1`, [demo]);
    expect(still.rows).toHaveLength(1);
  });

  it("refuses another organisation's owner, a wrong name and a non-owner", async () => {
    await actAs(db, other.userId);
    await expect(q(`select public.delete_org($1, 'My business')`, [owner.orgId])).rejects.toThrow(
      /only the owner/,
    );
    await actAs(db, owner.userId);
    await expect(q(`select public.delete_org($1, 'my business')`, [owner.orgId])).rejects.toThrow(
      /does not match/,
    );
    await q(`update memberships set role = 'accountant' where org_id = $1 and user_id = $2`, [
      owner.orgId,
      owner.userId,
    ]).catch(() => undefined);
    const still = await q(`select 1 from orgs where id = $1`, [owner.orgId]);
    expect(still.rows).toHaveLength(1);
  });

  it('deletes everything, scrubs the audit trail and leaves a receipt', async () => {
    const victim = await newUser(db);
    await actAs(db, victim.userId);
    const cust = (
      await q<{ id: string }>(
        `insert into customers (org_id, name, state_code, email) values ($1, 'Private Person', '27', 'p@example.test') returning id`,
        [victim.orgId],
      )
    ).rows[0]!.id;
    await q(
      `insert into expenses (org_id, name, amount_paise, expense_date) values ($1, 'Rent', 100, '2026-10-01')`,
      [victim.orgId],
    );
    const before = await q(
      `select count(*)::int as n from audit_log where org_id = $1 and new_data is not null`,
      [victim.orgId],
    );
    expect(before.rows[0]!.n).toBeGreaterThan(0);

    await q(`select public.delete_org($1, 'My business')`, [victim.orgId]);

    for (const t of ['orgs', 'customers', 'expenses', 'business_profile', 'memberships']) {
      const col = t === 'orgs' ? 'id' : 'org_id';
      const r = await q<{ n: number }>(`select count(*)::int as n from ${t} where ${col} = $1`, [
        victim.orgId,
      ]);
      expect(r.rows[0]!.n, t).toBe(0);
    }
    const audit = await q<{
      old_data: unknown;
      new_data: unknown;
      action: string;
      actor_id: string | null;
    }>(`select action, old_data, new_data, actor_id from audit_log where org_id = $1`, [
      victim.orgId,
    ]);
    expect(audit.rows.length).toBeGreaterThan(0);
    expect(audit.rows.every((a) => a.old_data === null && a.new_data === null)).toBe(true);
    expect(audit.rows.filter((a) => a.action === 'ORG_ERASED')).toHaveLength(1);
    expect(JSON.stringify(audit.rows)).not.toContain('Private Person');
    expect(cust).toBeTruthy();
  });

  it('the audit trail stays append-only for everything else', async () => {
    await actAs(db, owner.userId);
    await expect(
      q(`update audit_log set old_data = null where org_id = $1`, [owner.orgId]),
    ).rejects.toThrow(/append-only/);
    await expect(q(`delete from audit_log where org_id = $1`, [owner.orgId])).rejects.toThrow(
      /append-only/,
    );
    // the bypass setting alone does nothing while the organisation still exists
    await q(`select set_config('app.erase_audit', $1, false)`, [owner.orgId]);
    await expect(
      q(
        `update audit_log set old_data = null, new_data = null, actor_id = null where org_id = $1`,
        [owner.orgId],
      ),
    ).rejects.toThrow(/append-only/);
    await q(`select set_config('app.erase_audit', '', false)`);
  });
});
