import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actAs, pgliteUser, pgliteWithMigrations } from './pglite';

let db: PGlite;
let orgId: string;
let customerId: string;

async function newDraft(): Promise<{ id: string; updated_at: string }> {
  const inv = await db.query<{ id: string; updated_at: string }>(
    `insert into invoices (org_id, customer_id, fy, status, issue_date, due_date,
       supplier_state_code, place_of_supply, taxable_paise, cgst_paise, sgst_paise, total_paise)
     values ($1, $2, '26-27', 'draft', '2026-10-01', '2026-10-31', '27', '27', 100000, 9000, 9000, 118000)
     returning id, updated_at::text`,
    [orgId, customerId],
  );
  const id = inv.rows[0]!.id;
  await db.query(
    `insert into invoice_lines (org_id, invoice_id, position, description, qty, rate_paise, gst_rate,
       taxable_paise, cgst_paise, sgst_paise, total_paise)
     values ($1, $2, 1, 'Item', 1, 100000, 18, 100000, 9000, 9000, 118000)`,
    [orgId, id],
  );
  const fresh = await db.query<{ updated_at: string }>(
    'select updated_at::text from invoices where id = $1',
    [id],
  );
  return { id, updated_at: fresh.rows[0]!.updated_at };
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

describe('invoice numbering', () => {
  it('drafts have no number', async () => {
    const d = await newDraft();
    const r = await db.query<{ number: string | null }>(
      'select number from invoices where id = $1',
      [d.id],
    );
    expect(r.rows[0]!.number).toBeNull();
  });

  it('20 parallel issues give consecutive numbers with no repeats', async () => {
    const drafts = await Promise.all(Array.from({ length: 20 }, () => newDraft()));
    const results = await Promise.all(
      drafts.map((d) =>
        db.query<{ number: string }>(
          'select (public.issue_invoice($1, $2::timestamptz)).number as number',
          [d.id, d.updated_at],
        ),
      ),
    );
    const seqs = results.map((r) => Number(r.rows[0]!.number.split('/')[2])).sort((a, b) => a - b);
    expect(new Set(seqs).size).toBe(20);
    const first = seqs[0]!;
    expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => first + i));
    expect(results[0]!.rows[0]!.number).toMatch(/^INV\/26-27\/\d{4}$/);
  });

  it('rejects a stale updated_at as a conflict and burns no number', async () => {
    const d = await newDraft();
    const before = await db.query<{ last_seq: number }>(
      `select last_seq from invoice_counters where org_id = $1 and series = 'INV'`,
      [orgId],
    );
    await expect(
      db.query('select public.issue_invoice($1, $2::timestamptz)', [d.id, '2020-01-01T00:00:00Z']),
    ).rejects.toMatchObject({ message: expect.stringContaining('conflict') });
    const after = await db.query<{ last_seq: number }>(
      `select last_seq from invoice_counters where org_id = $1 and series = 'INV'`,
      [orgId],
    );
    expect(after.rows[0]!.last_seq).toBe(before.rows[0]!.last_seq);
  });

  it('cannot issue twice', async () => {
    const d = await newDraft();
    await db.query('select public.issue_invoice($1, $2::timestamptz)', [d.id, d.updated_at]);
    const again = await db.query<{ updated_at: string }>(
      'select updated_at::text from invoices where id = $1',
      [d.id],
    );
    await expect(
      db.query('select public.issue_invoice($1, $2::timestamptz)', [
        d.id,
        again.rows[0]!.updated_at,
      ]),
    ).rejects.toThrow(/not a draft/);
  });

  it('credit and debit notes number in their own series', async () => {
    const d = await newDraft();
    const inv = await db.query<{ id: string }>(
      'select (public.issue_invoice($1, $2::timestamptz)).id as id',
      [d.id, d.updated_at],
    );
    const mk = async (type: 'credit' | 'debit') => {
      const n = await db.query<{ id: string; updated_at: string }>(
        `insert into notes (org_id, invoice_id, note_type, issue_date, total_paise)
         values ($1, $2, $3, '2026-10-05', 1000) returning id, updated_at::text`,
        [orgId, inv.rows[0]!.id, type],
      );
      const r = await db.query<{ number: string }>(
        'select (public.issue_note($1, $2::timestamptz)).number as number',
        [n.rows[0]!.id, n.rows[0]!.updated_at],
      );
      return r.rows[0]!.number;
    };
    expect(await mk('credit')).toBe('CN/26-27/0001');
    expect(await mk('debit')).toBe('DN/26-27/0001');
    expect(await mk('credit')).toBe('CN/26-27/0002');
  });
});
