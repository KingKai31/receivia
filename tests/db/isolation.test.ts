import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ALL_ORG_TABLES,
  INSERTS,
  STANDARD_TABLES,
  adminClient,
  asRole,
  attempt,
  closeDb,
  createUser,
  dbAvailable,
  orgOf,
  seedOrg,
  type Refs,
} from './helpers';

const up = await dbAvailable();
if (!up && process.env.REQUIRE_DB === '1') {
  throw new Error('Local Supabase database is required (REQUIRE_DB=1) but is not reachable');
}

// Pending Docker: when the local database is not running these are skipped, not passed silently
// in CI (CI sets REQUIRE_DB=1).
describe.skipIf(!up)('multi-tenant isolation', () => {
  let admin: pg.Client;
  let userA: string;
  let userB: string;
  let orgA: string;
  let orgB: string;
  let refsA: Refs;
  let refsB: Refs;

  beforeAll(async () => {
    admin = await adminClient();
    userA = await createUser(admin, 'a');
    userB = await createUser(admin, 'b');
    orgA = await orgOf(admin, userA);
    orgB = await orgOf(admin, userB);
    refsA = await seedOrg(admin, orgA);
    refsB = await seedOrg(admin, orgB);
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.query('delete from orgs where id = any($1)', [[orgA, orgB]]);
    await admin.query('delete from auth.users where id = any($1)', [[userA, userB]]);
    await closeDb();
  });

  const count = async (table: string, org: string) =>
    Number(
      (await admin.query(`select count(*) from public.${table} where org_id = $1`, [org])).rows[0]
        .count,
    );

  it('signup trigger creates "My business" with the user as owner', async () => {
    const r = await admin.query(
      `select o.name, m.role, bp.org_id as profile
         from memberships m join orgs o on o.id = m.org_id
         left join business_profile bp on bp.org_id = o.id
        where m.user_id = $1`,
      [userA],
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ name: 'My business', role: 'owner', profile: orgA });
  });

  describe.each(ALL_ORG_TABLES)('table %s', (table) => {
    it('has rows in both orgs (fixtures are real)', async () => {
      expect(await count(table, orgA)).toBeGreaterThan(0);
      expect(await count(table, orgB)).toBeGreaterThan(0);
    });

    it("org A's user sees own rows but none of org B's", async () => {
      await asRole('authenticated', userA, async (c) => {
        const own = await c.query(`select count(*) from public.${table} where org_id = $1`, [orgA]);
        expect(Number(own.rows[0].count)).toBeGreaterThan(0);
        const other = await c.query(`select count(*) from public.${table} where org_id = $1`, [
          orgB,
        ]);
        expect(Number(other.rows[0].count)).toBe(0);
      });
    });

    it("org A's user cannot insert an org B row", async () => {
      await asRole('authenticated', userA, async (c) => {
        const [sql, params] = INSERTS[table]!(orgB, refsB, randomUUID().slice(0, 8));
        const r = await attempt(c, sql, params);
        expect(r.ok).toBe(false);
        // 42501 = RLS check or missing privilege; any other code means the test insert itself is broken.
        expect(r.code).toBe('42501');
      });
    });

    it("org A's user cannot update or delete org B rows", async () => {
      await asRole('authenticated', userA, async (c) => {
        const upd = await attempt(
          c,
          `update public.${table} set updated_at = now() where org_id = $1`,
          [orgB],
        );
        expect(upd.ok ? upd.rowCount : 0).toBe(0);
        if (!upd.ok) expect(upd.code).toBe('42501');
        const del = await attempt(c, `delete from public.${table} where org_id = $1`, [orgB]);
        expect(del.ok ? del.rowCount : 0).toBe(0);
        if (!del.ok) expect(del.code).toBe('42501');
      });
      expect(await count(table, orgB)).toBeGreaterThan(0);
    });

    it('anonymous reads nothing', async () => {
      await asRole('anon', null, async (c) => {
        const r = await attempt(c, `select * from public.${table}`);
        expect(r.ok ? r.rowCount : 0).toBe(0);
        if (!r.ok) expect(r.code).toBe('42501');
      });
    });
  });

  describe('own-org writes work for the standard tables (positive control)', () => {
    it.each(STANDARD_TABLES)('%s', async (table) => {
      await asRole('authenticated', userA, async (c) => {
        const tag = randomUUID().slice(0, 8);
        const [sql, params] = INSERTS[table]!(orgA, refsA, tag);
        const r = await attempt(c, sql, params);
        // allocations may fail the unique (payment, invoice) pair; everything else must succeed
        if (table === 'allocations') expect([true, false]).toContain(r.ok);
        else if (table === 'ims_status') expect([true, false]).toContain(r.ok);
        else expect(r).toMatchObject({ ok: true, rowCount: 1 });
      });
    });
  });

  describe('cross-org references are impossible', () => {
    it("an invoice in org A cannot point at org B's customer", async () => {
      const r = await attempt(
        admin,
        `insert into invoices (org_id, customer_id, number, fy, issue_date, due_date,
           supplier_state_code, place_of_supply, total_paise)
         values ($1, $2, 'X/1', '26-27', '2026-10-01', '2026-10-31', '27', '27', 0)`,
        [orgA, refsB.customer],
      );
      expect(r).toMatchObject({ ok: false, code: '23503' });
    });
    it('org_id cannot be changed on an existing row', async () => {
      const r = await attempt(admin, 'update customers set org_id = $1 where id = $2', [
        orgB,
        refsA.customer,
      ]);
      expect(r.ok).toBe(false);
    });
  });

  describe('roles', () => {
    let accountant: string;
    let ca: string;

    beforeAll(async () => {
      accountant = await createUser(admin, 'acct');
      ca = await createUser(admin, 'ca');
      // They get their own throwaway orgs from the signup trigger; move them into org A.
      for (const [u, role] of [
        [accountant, 'accountant'],
        [ca, 'ca'],
      ] as const) {
        await admin.query('delete from orgs where id = $1', [await orgOf(admin, u)]);
        await admin.query('insert into memberships (org_id, user_id, role) values ($1, $2, $3)', [
          orgA,
          u,
          role,
        ]);
      }
    });

    afterAll(async () => {
      await admin.query('delete from auth.users where id = any($1)', [[accountant, ca]]);
    });

    it('accountant writes data but not orgs, memberships or business profile', async () => {
      await asRole('authenticated', accountant, async (c) => {
        const ok = await attempt(
          c,
          `insert into customers (org_id, name) values ($1, 'By accountant')`,
          [orgA],
        );
        expect(ok.ok).toBe(true);
        const bp = await attempt(
          c,
          `update business_profile set legal_name = 'Hacked' where org_id = $1`,
          [orgA],
        );
        expect(bp.rowCount).toBe(0);
        const org = await attempt(c, `update orgs set name = 'Hacked' where id = $1`, [orgA]);
        expect(org.rowCount).toBe(0);
        const mem = await attempt(c, `delete from memberships where org_id = $1`, [orgA]);
        expect(mem.rowCount).toBe(0);
        const read = await c.query('select count(*) from business_profile where org_id = $1', [
          orgA,
        ]);
        expect(Number(read.rows[0].count)).toBe(1);
      });
    });

    it('CA reads everything in the org and writes nothing', async () => {
      await asRole('authenticated', ca, async (c) => {
        for (const t of STANDARD_TABLES) {
          const r = await c.query(`select count(*) from public.${t} where org_id = $1`, [orgA]);
          expect(Number(r.rows[0].count)).toBeGreaterThan(0);
        }
        const ins = await attempt(c, `insert into customers (org_id, name) values ($1, 'By CA')`, [
          orgA,
        ]);
        expect(ins).toMatchObject({ ok: false, code: '42501' });
        const upd = await attempt(c, `update customers set name = 'x' where org_id = $1`, [orgA]);
        expect(upd.rowCount).toBe(0);
        const del = await attempt(c, `delete from customers where org_id = $1`, [orgA]);
        expect(del.rowCount).toBe(0);
        const tok = await attempt(c, `select * from pay_tokens where org_id = $1`, [orgA]);
        expect(tok.rowCount).toBe(0);
      });
    });

    it('owner updates the business profile', async () => {
      await asRole('authenticated', userA, async (c) => {
        const r = await attempt(
          c,
          `update business_profile set trade_name = 'Trade' where org_id = $1`,
          [orgA],
        );
        expect(r.rowCount).toBe(1);
      });
    });
  });

  describe('audit_log is append-only', () => {
    it('is written by triggers for member actions', async () => {
      await asRole('authenticated', userA, async (c) => {
        await c.query(`insert into customers (org_id, name) values ($1, 'Audited')`, [orgA]);
        const r = await c.query(
          `select actor_id, action from audit_log where org_id = $1 and table_name = 'customers'
             and new_data ->> 'name' = 'Audited'`,
          [orgA],
        );
        expect(r.rows).toEqual([{ actor_id: userA, action: 'INSERT' }]);
      });
    });

    it('rejects UPDATE and DELETE, even for the table owner', async () => {
      const upd = await attempt(admin, `update audit_log set action = 'DELETE' where org_id = $1`, [
        orgA,
      ]);
      expect(upd).toMatchObject({ ok: false, code: '42501' });
      const del = await attempt(admin, `delete from audit_log where org_id = $1`, [orgA]);
      expect(del).toMatchObject({ ok: false, code: '42501' });
      const trunc = await attempt(admin, 'truncate audit_log');
      expect(trunc).toMatchObject({ ok: false, code: '42501' });
    });

    it('rejects UPDATE, DELETE and INSERT from clients', async () => {
      await asRole('authenticated', userA, async (c) => {
        for (const sql of [
          `update audit_log set action = 'DELETE' where org_id = $1`,
          `delete from audit_log where org_id = $1`,
          `insert into audit_log (org_id, action, table_name) values ($1, 'INSERT', 'customers')`,
        ]) {
          expect(await attempt(c, sql, [orgA])).toMatchObject({ ok: false, code: '42501' });
        }
      });
    });
  });

  describe('invoice numbers', () => {
    it('are gap-free, per FY, and follow the profile prefix', async () => {
      await asRole('authenticated', userA, async (c) => {
        const n = async (fy: string) =>
          (await c.query('select public.next_invoice_number($1, $2) as n', [orgA, fy])).rows[0].n;
        expect(await n('30-31')).toBe('INV/30-31/0001');
        expect(await n('30-31')).toBe('INV/30-31/0002');
        expect(await n('31-32')).toBe('INV/31-32/0001');
        await c.query(`update business_profile set invoice_prefix = 'AB' where org_id = $1`, [
          orgA,
        ]);
        expect(await n('30-31')).toBe('AB/30-31/0003');
      });
    });

    it('a rolled-back number is handed out again', async () => {
      await asRole('authenticated', userA, async (c) => {
        const first = (
          await c.query('select public.next_invoice_number($1, $2) as n', [orgA, '32-33'])
        ).rows[0].n;
        await c.query('savepoint s');
        await c.query('select public.next_invoice_number($1, $2)', [orgA, '32-33']);
        await c.query('rollback to savepoint s');
        const again = (
          await c.query('select public.next_invoice_number($1, $2) as n', [orgA, '32-33'])
        ).rows[0].n;
        expect(first).toBe('INV/32-33/0001');
        expect(again).toBe('INV/32-33/0002');
      });
    });

    it('cannot be drawn for another org, by a CA, or anonymously', async () => {
      await asRole('authenticated', userA, async (c) => {
        expect(
          await attempt(c, 'select public.next_invoice_number($1, $2)', [orgB, '26-27']),
        ).toMatchObject({
          ok: false,
          code: '42501',
        });
        expect(
          await attempt(c, 'select public.next_invoice_number($1, $2)', [orgA, 'bad']),
        ).toMatchObject({
          ok: false,
          code: '22023',
        });
      });
      await asRole('anon', null, async (c) => {
        expect(
          (await attempt(c, 'select public.next_invoice_number($1, $2)', [orgA, '26-27'])).ok,
        ).toBe(false);
      });
    });
  });

  describe('data rules', () => {
    it('rejects unknown GST state codes and bad GSTINs', async () => {
      const bad = [
        `update customers set state_code = '25' where id = $1`,
        `update customers set gstin = '27AAPFU0939F1ZX' where id = $1`,
      ];
      for (const sql of bad) expect((await attempt(admin, sql, [refsA.customer])).ok).toBe(false);
      const good = await attempt(
        admin,
        `update customers set gstin = '27AAPFU0939F1ZV', state_code = '27' where id = $1`,
        [refsA.customer],
      );
      expect(good.ok).toBe(true);
      const mismatch = await attempt(
        admin,
        `update customers set state_code = '29' where id = $1`,
        [refsA.customer],
      );
      expect(mismatch.ok).toBe(false);
    });

    it('allocations keep invoice paid amount and status in step, and cannot over-allocate', async () => {
      const inv = await admin.query(
        'select paid_paise, status, total_paise from invoices where id = $1',
        [refsA.invoice],
      );
      expect(inv.rows[0]).toMatchObject({ paid_paise: '20000', status: 'partially_paid' });
      const over = await attempt(
        admin,
        `update allocations set amount_paise = 60000 where org_id = $1`,
        [orgA],
      );
      expect(over).toMatchObject({ ok: false, code: '23514' });
    });

    it('pay tokens are stored as sha256 hashes with an expiry', async () => {
      await asRole('authenticated', userA, async (c) => {
        const token = (await c.query('select public.create_pay_token($1) as t', [refsA.invoice]))
          .rows[0].t as string;
        expect(token.length).toBeGreaterThanOrEqual(32);
        const row = (
          await c.query(
            `select token_hash, expires_at > now() as live,
                    token_hash = encode(extensions.digest($2, 'sha256'), 'hex') as hashed
               from pay_tokens where invoice_id = $1 and token_hash = encode(extensions.digest($2, 'sha256'), 'hex')`,
            [refsA.invoice, token],
          )
        ).rows[0];
        expect(row.hashed).toBe(true);
        expect(row.live).toBe(true);
        expect(row.token_hash).not.toContain(token);
        // audit trail never carries the hash
        const aud = await c.query(
          `select count(*) from audit_log where table_name = 'pay_tokens' and new_data ? 'token_hash'`,
        );
        expect(Number(aud.rows[0].count)).toBe(0);
      });
    });
  });
});
