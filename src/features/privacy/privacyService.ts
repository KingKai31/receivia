import type { SupabaseClient } from '@supabase/supabase-js';
import { fromPgError } from '@/lib/service/errors';
import { supabase } from '@/lib/supabase';

/** The seeded public demo organisation. It can never be deleted. */
export const DEMO_ORG_ID = '00000000-0000-4000-8000-00000000de60';

/** Tables included in "Export my data", in a readable order. */
export const EXPORT_TABLES = [
  'business_profile',
  'customers',
  'customer_consents',
  'invoices',
  'invoice_lines',
  'notes',
  'payments',
  'allocations',
  'bank_txns',
  'payment_claims',
  'disputes',
  'promises',
  'reminders',
  'messages',
  'expenses',
  'tds_entries',
  'ims_status',
  'agent_actions',
  'memberships',
] as const;
export type ExportTable = (typeof EXPORT_TABLES)[number];

const PAGE = 1000;

async function allRows(client: SupabaseClient, table: string, orgId: string) {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const res = await client
      .from(table)
      .select('*')
      .eq('org_id', orgId)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (res.error) throw fromPgError(res.error);
    const rows = (res.data ?? []) as Record<string, unknown>[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

export interface OrgExport {
  exported_at: string;
  org_id: string;
  account: { user_id: string | null; email: string | null };
  tables: Record<string, Record<string, unknown>[]>;
}

/** Everything the signed-in user can read about the organisation. Row security decides what that is. */
export async function exportOrgData(
  orgId: string,
  client: SupabaseClient = supabase,
): Promise<OrgExport> {
  const { data: u } = await client.auth.getUser();
  const tables: OrgExport['tables'] = {};
  for (const t of EXPORT_TABLES) tables[t] = await allRows(client, t, orgId);
  return {
    exported_at: new Date().toISOString(),
    org_id: orgId,
    account: { user_id: u.user?.id ?? null, email: u.user?.email ?? null },
    tables,
  };
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) || /^[=+\-@\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180 CSV with every key seen in any row as a column. Text starting with = + - @ is quoted. */
export function toCsv(rows: Record<string, unknown>[]): string {
  const cols: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  const lines = [cols.map(cell).join(',')];
  for (const r of rows) lines.push(cols.map((c) => cell(r[c])).join(','));
  return lines.join('\r\n') + '\r\n';
}

export function download(filename: string, mime: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Deletes the organisation (owner only, name typed exactly, never the demo). */
export async function deleteOrg(
  orgId: string,
  typedName: string,
  client: SupabaseClient = supabase,
): Promise<void> {
  if (orgId === DEMO_ORG_ID) throw new Error('The demo organisation cannot be deleted.');
  const res = await client.rpc('delete_org', { p_org: orgId, p_confirm: typedName });
  if (res.error) throw fromPgError(res.error);
}

export type ConsentChannel = 'email' | 'whatsapp' | 'sms' | 'any';
export type ConsentBasis = 'written' | 'verbal' | 'pay_page' | 'existing_relationship' | 'other';

export interface ConsentRecord {
  id: string;
  channel: ConsentChannel;
  status: 'granted' | 'withdrawn';
  basis: ConsentBasis;
  note: string | null;
  recorded_on: string;
  created_at: string;
}

export async function listConsents(
  customerId: string,
  client: SupabaseClient = supabase,
): Promise<ConsentRecord[]> {
  const res = await client
    .from('customer_consents')
    .select('id, channel, status, basis, note, recorded_on, created_at')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (res.error) throw fromPgError(res.error);
  return (res.data ?? []) as ConsentRecord[];
}

export async function addConsent(
  input: {
    orgId: string;
    customerId: string;
    channel: ConsentChannel;
    status: 'granted' | 'withdrawn';
    basis: ConsentBasis;
    note: string;
  },
  client: SupabaseClient = supabase,
): Promise<void> {
  const res = await client.from('customer_consents').insert({
    org_id: input.orgId,
    customer_id: input.customerId,
    channel: input.channel,
    status: input.status,
    basis: input.basis,
    note: input.note.trim() ? input.note.trim().slice(0, 500) : null,
  });
  if (res.error) throw fromPgError(res.error);
}

/** The state that counts: the newest record per channel. */
export function currentConsent(records: ConsentRecord[]): Record<string, 'granted' | 'withdrawn'> {
  const out: Record<string, 'granted' | 'withdrawn'> = {};
  for (const r of records) if (!(r.channel in out)) out[r.channel] = r.status;
  return out;
}
