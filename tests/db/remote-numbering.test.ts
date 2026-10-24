import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DATABASE_URL, dbAvailable } from './helpers';

/** The session pooler caps clients at 15; the transaction pooler (6543) allows more. */
const CONTENTION_URL = (() => {
  const u = new URL(DATABASE_URL);
  if (u.hostname.endsWith('pooler.supabase.com') && u.port === '5432') u.port = '6543';
  return u.toString();
})();

/**
 * Real multi-connection contention: 20 separate connections issue 20 drafts at once.
 * Runs only against a real Postgres (npm run test:db:remote); PGlite has one connection.
 */
const up = process.env.REMOTE_DB === '1' && (await dbAvailable());

describe.skipIf(!up)('invoice numbering with 20 real connections', () => {
  const userId = randomUUID();
  let orgId = '';
  let customerId = '';
  let admin: pg.Client;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await admin.query(
      `insert into auth.users (id, aud, role, email) values ($1, 'authenticated', 'authenticated', $2)`,
      [userId, `parallel-${userId}@example.test`],
    );
    orgId = (
      await admin.query('select org_id from public.memberships where user_id = $1', [userId])
    ).rows[0].org_id;
    customerId = (
      await admin.query(
        `insert into public.customers (org_id, name, state_code) values ($1, 'Parallel buyer', '27') returning id`,
        [orgId],
      )
    ).rows[0].id;
  }, 60000);

  afterAll(async () => {
    await admin?.query('delete from public.orgs where id = $1', [orgId]);
    await admin?.query('delete from auth.users where id = $1', [userId]);
    await admin?.end().catch(() => undefined);
  });

  it('gives 20 consecutive, unique numbers', async () => {
    const drafts: { id: string; updated_at: string }[] = [];
    for (let i = 0; i < 20; i++) {
      const r = await admin.query(
        `insert into public.invoices (org_id, customer_id, fy, status, issue_date, due_date,
           supplier_state_code, place_of_supply, taxable_paise, cgst_paise, sgst_paise, total_paise)
         values ($1, $2, '26-27', 'draft', '2026-10-01', '2026-10-31', '27', '27', 100000, 9000, 9000, 118000)
         returning id, updated_at::text`,
        [orgId, customerId],
      );
      await admin.query(
        `insert into public.invoice_lines (org_id, invoice_id, position, description, qty, rate_paise, gst_rate,
           taxable_paise, cgst_paise, sgst_paise, total_paise)
         values ($1, $2, 1, 'Item', 1, 100000, 18, 100000, 9000, 9000, 118000)`,
        [orgId, r.rows[0].id],
      );
      const fresh = await admin.query(
        'select updated_at::text from public.invoices where id = $1',
        [r.rows[0].id],
      );
      drafts.push({ id: r.rows[0].id, updated_at: fresh.rows[0].updated_at });
    }
    const clients = await Promise.all(
      drafts.map(async () => {
        const c = new pg.Client({ connectionString: CONTENTION_URL });
        await c.connect();
        return c;
      }),
    );
    try {
      const results = await Promise.all(
        clients.map(async (c, i) => {
          await c.query('begin');
          await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
          await c.query(`select set_config('request.jwt.claims', $1, true)`, [
            JSON.stringify({ sub: userId, role: 'authenticated' }),
          ]);
          const r = await c.query(
            'select (public.issue_invoice($1, $2::timestamptz)).number as number',
            [drafts[i]!.id, drafts[i]!.updated_at],
          );
          await c.query('commit');
          return r;
        }),
      );
      const seqs = results.map((r) => Number(r.rows[0].number.split('/')[2])).sort((a, b) => a - b);
      expect(new Set(seqs).size).toBe(20);
      expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => seqs[0]! + i));
    } finally {
      await Promise.all(clients.map((c) => c.end().catch(() => undefined)));
    }
  }, 120000);
});
