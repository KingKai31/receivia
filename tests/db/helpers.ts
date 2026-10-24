import { randomUUID } from 'node:crypto';
import pg from 'pg';

export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/** True when the local Supabase database answers. CI sets REQUIRE_DB=1 so a missing DB fails. */
export async function dbAvailable(): Promise<boolean> {
  const c = new pg.Client({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: process.env.REMOTE_DB ? 10000 : 2000,
  });
  try {
    await c.connect();
    await c.query('select 1');
    return true;
  } catch {
    return false;
  } finally {
    await c.end().catch(() => undefined);
  }
}

let shared: pg.Client | null = null;

/** One shared superuser connection; role-bound work runs in rolled-back transactions on it. */
export async function adminClient(): Promise<pg.Client> {
  if (!shared) {
    const c = new pg.Client({ connectionString: DATABASE_URL });
    await c.connect();
    shared = c;
  }
  return shared;
}

export async function closeDb(): Promise<void> {
  const c = shared;
  shared = null;
  await c?.end().catch(() => undefined);
}

export type SessionRole = 'authenticated' | 'anon';

/** Runs fn inside a transaction as an RLS-bound role, always rolling back. */
export async function asRole<T>(
  role: SessionRole,
  userId: string | null,
  fn: (c: pg.Client) => Promise<T>,
): Promise<T> {
  const c = await adminClient();
  try {
    await c.query('begin');
    await c.query(`set local role ${role}`);
    const claims = JSON.stringify(userId ? { sub: userId, role } : { role });
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
    if (userId) await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    return await fn(c);
  } finally {
    await c.query('rollback').catch(() => undefined);
  }
}

export interface Attempt {
  ok: boolean;
  rowCount: number;
  code?: string;
}

/** Runs a statement inside a savepoint so a failure does not abort the surrounding transaction. */
export async function attempt(c: pg.Client, sql: string, params: unknown[] = []): Promise<Attempt> {
  // Inside a transaction a failure must not poison it; in autocommit there is nothing to undo.
  const inTx = await c.query('savepoint attempt').then(
    () => true,
    () => false,
  );
  try {
    const r = await c.query(sql, params);
    if (inTx) await c.query('release savepoint attempt');
    return { ok: true, rowCount: r.rowCount ?? 0 };
  } catch (e) {
    if (inTx) await c.query('rollback to savepoint attempt');
    return { ok: false, rowCount: 0, code: (e as { code?: string }).code };
  }
}

export async function createUser(admin: pg.Client, label: string): Promise<string> {
  const id = randomUUID();
  await admin.query(
    `insert into auth.users (id, aud, role, email) values ($1, 'authenticated', 'authenticated', $2)`,
    [id, `iso-${label}-${id}@example.test`],
  );
  return id;
}

export async function orgOf(admin: pg.Client, userId: string): Promise<string> {
  const r = await admin.query<{ org_id: string }>(
    'select org_id from public.memberships where user_id = $1',
    [userId],
  );
  return r.rows[0]!.org_id;
}

export interface Refs {
  customer: string;
  invoice: string;
  payment: string;
}

type Builder = (org: string, refs: Refs, tag: string) => [string, unknown[]];

/** One INSERT per org-scoped table, used both for fixtures and for cross-org attempts. */
export const INSERTS: Record<string, Builder> = {
  customers: (o, _r, t) => [
    `insert into customers (org_id, name, state_code) values ($1, $2, '27')`,
    [o, `Cust ${t}`],
  ],
  invoices: (o, r, t) => [
    `insert into invoices (org_id, customer_id, number, fy, status, issue_date, due_date,
       supplier_state_code, place_of_supply, taxable_paise, cgst_paise, sgst_paise, total_paise)
     values ($1, $2, $3, '26-27', 'issued', '2026-10-01', '2026-10-31', '27', '27', 100000, 9000, 9000, 118000)`,
    [o, r.customer, `T/${t}`.slice(0, 16)],
  ],
  invoice_lines: (o, r, t) => [
    `insert into invoice_lines (org_id, invoice_id, position, description, qty, rate_paise, gst_rate,
       taxable_paise, cgst_paise, sgst_paise, total_paise)
     values ($1, $2, $3, 'Item', 1, 100000, 18, 100000, 9000, 9000, 118000)`,
    [o, r.invoice, t.startsWith('fx') ? 1 : 2 + (Number.parseInt(t.slice(0, 6), 16) % 100000)],
  ],
  notes: (o, r, t) => [
    `insert into notes (org_id, invoice_id, note_type, number, issue_date, total_paise)
     values ($1, $2, 'credit', $3, '2026-10-05', 1000)`,
    [o, r.invoice, `N/${t}`.slice(0, 16)],
  ],
  invoice_counters: (o, _r, t) => [
    `insert into invoice_counters (org_id, fy, last_seq) values ($1, $2, 1)`,
    [o, `${10 + (t.length % 80)}-${11 + (t.length % 80)}`],
  ],
  payments: (o, r) => [
    `insert into payments (org_id, customer_id, amount_paise, received_on) values ($1, $2, 50000, '2026-10-10')`,
    [o, r.customer],
  ],
  allocations: (o, r) => [
    `insert into allocations (org_id, payment_id, invoice_id, amount_paise) values ($1, $2, $3, 20000)`,
    [o, r.payment, r.invoice],
  ],
  bank_txns: (o, _r, t) => [
    `insert into bank_txns (org_id, txn_date, amount_paise, dedupe_hash) values ($1, '2026-10-10', 50000, $2)`,
    [o, `h-${t}`],
  ],
  disputes: (o, r) => [
    `insert into disputes (org_id, invoice_id, reason) values ($1, $2, 'wrong quantity')`,
    [o, r.invoice],
  ],
  promises: (o, r) => [
    `insert into promises (org_id, invoice_id, promised_for) values ($1, $2, '2026-11-01')`,
    [o, r.invoice],
  ],
  reminders: (o, r, t) => [
    `insert into reminders (org_id, invoice_id, stage, scheduled_for) values ($1, $2, $3, now())`,
    [o, r.invoice, t.startsWith('fx') ? 'due_today' : 'final'],
  ],
  messages: (o) => [
    `insert into messages (org_id, channel, body) values ($1, 'email', 'hello')`,
    [o],
  ],
  expenses: (o) => [
    `insert into expenses (org_id, name, amount_paise, expense_date) values ($1, 'Rent', 1000000, '2026-10-01')`,
    [o],
  ],
  tds_entries: (o) => [
    `insert into tds_entries (org_id, section, rate, amount_paise) values ($1, '194C', 1, 1000)`,
    [o],
  ],
  ims_status: (o, r) => [
    `insert into ims_status (org_id, invoice_id) values ($1, $2)`,
    [o, r.invoice],
  ],
  agent_actions: (o) => [
    `insert into agent_actions (org_id, action_type) values ($1, 'send_reminder')`,
    [o],
  ],
  pay_tokens: (o, r, t) => [
    `insert into pay_tokens (org_id, invoice_id, token_hash, expires_at)
     values ($1, $2, encode(extensions.digest($3, 'sha256'), 'hex'), now() + interval '1 day')`,
    [o, r.invoice, `tok-${t}`],
  ],
  business_profile: (o) => [`insert into business_profile (org_id) values ($1)`, [o]],
  memberships: (o) => [
    `insert into memberships (org_id, user_id, role) values ($1, $2, 'ca')`,
    [o, randomUUID()],
  ],
  orgs: (_o, _r, t) => [`insert into orgs (name) values ($1)`, [`Org ${t}`]],
  audit_log: (o) => [
    `insert into audit_log (org_id, action, table_name) values ($1, 'INSERT', 'customers')`,
    [o],
  ],
};

/** Tables that follow the standard rule: members read, owner/accountant write. */
export const STANDARD_TABLES = [
  'customers',
  'invoices',
  'invoice_lines',
  'notes',
  'payments',
  'allocations',
  'bank_txns',
  'disputes',
  'promises',
  'reminders',
  'messages',
  'expenses',
  'tds_entries',
  'ims_status',
  'agent_actions',
] as const;

export const ALL_ORG_TABLES = [
  'orgs',
  'memberships',
  'business_profile',
  ...STANDARD_TABLES,
  'invoice_counters',
  'pay_tokens',
  'audit_log',
] as const;

/** Inserts a full set of fixtures into an org as superuser. */
export async function seedOrg(admin: pg.Client, org: string): Promise<Refs> {
  const fx = `fx${org.slice(0, 6)}`;
  const one = async (table: string, refs: Refs, tag: string) => {
    const [sql, params] = INSERTS[table]!(org, refs, tag);
    await admin.query(sql, params);
  };
  const id = async (table: string) =>
    (await admin.query<{ id: string }>(`select id from ${table} where org_id = $1 limit 1`, [org]))
      .rows[0]!.id;
  const refs = { customer: '', invoice: '', payment: '' };
  await one('customers', refs, fx);
  refs.customer = await id('customers');
  await one('invoices', refs, fx);
  refs.invoice = await id('invoices');
  await one('payments', refs, fx);
  refs.payment = await id('payments');
  for (const t of [
    'invoice_lines',
    'notes',
    'invoice_counters',
    'allocations',
    'bank_txns',
    'disputes',
    'promises',
    'reminders',
    'messages',
    'expenses',
    'tds_entries',
    'ims_status',
    'agent_actions',
    'pay_tokens',
  ]) {
    await one(t, refs, fx);
  }
  return refs;
}
