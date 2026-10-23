import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, todayIST, type ISODate } from '@/lib/dates';
import { PAGE_SIZE, fromPgError, likeTerm, range, unwrap, type Page } from '@/lib/service/errors';
import { supabase } from '@/lib/supabase';
import {
  DUE_SOON_DAYS,
  computeDraft,
  headerPayload,
  linesPayload,
  type BuyerInfo,
  type DisplayStatus,
  type DraftInput,
  type SupplierInfo,
} from './invoiceModel';

export interface Invoice {
  id: string;
  org_id: string;
  customer_id: string;
  number: string | null;
  fy: string;
  invoice_type: 'tax_invoice' | 'bill_of_supply' | 'invoice';
  status: 'draft' | 'issued' | 'partially_paid' | 'paid' | 'void';
  issue_date: string;
  due_date: string;
  supplier_state_code: string;
  place_of_supply: string;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  round_off_paise: number;
  total_paise: number;
  paid_paise: number;
  notes: string | null;
  source: 'manual' | 'import';
  reverse_charge: boolean;
  delivery_address: string | null;
  disputed: boolean;
  updated_at: string;
  created_at: string;
}

export interface InvoiceLine {
  id: string;
  position: number;
  description: string;
  hsn_sac: string | null;
  qty: number;
  unit: string | null;
  rate_paise: number;
  discount_paise: number;
  gst_rate: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_paise: number;
}

export type InvoiceListRow = Invoice & { customers: { name: string } | null };

/** Creates (id null) or updates a draft atomically via save_invoice; no number is assigned. */
export async function saveDraft(args: {
  orgId: string;
  invoice?: Pick<Invoice, 'id' | 'updated_at'>;
  input: DraftInput;
  supplier: SupplierInfo;
  buyer: BuyerInfo;
  client?: SupabaseClient;
}): Promise<Invoice> {
  const client = args.client ?? supabase;
  const computed = computeDraft(args.input, args.supplier, args.buyer);
  const res = await client.rpc('save_invoice', {
    p_org: args.orgId,
    p_id: args.invoice?.id ?? null,
    p_expected: args.invoice?.updated_at ?? null,
    p_header: headerPayload(args.input, computed, args.supplier.stateCode),
    p_lines: linesPayload(args.input, computed),
  });
  return unwrap(res) as Invoice;
}

/** Assigns the next number and marks the draft issued, in one database transaction. */
export async function issueInvoice(
  invoice: Pick<Invoice, 'id' | 'updated_at'>,
  client: SupabaseClient = supabase,
): Promise<Invoice> {
  const res = await client.rpc('issue_invoice', {
    p_invoice: invoice.id,
    p_expected: invoice.updated_at,
  });
  return unwrap(res) as Invoice;
}

export async function getInvoice(
  id: string,
  client: SupabaseClient = supabase,
): Promise<{ invoice: Invoice; lines: InvoiceLine[] }> {
  const [inv, lines] = await Promise.all([
    client.from('invoices').select('*').eq('id', id).maybeSingle(),
    client.from('invoice_lines').select('*').eq('invoice_id', id).order('position'),
  ]);
  const invoice = unwrap(inv) as Invoice;
  if (lines.error) throw fromPgError(lines.error);
  return { invoice, lines: (lines.data ?? []) as InvoiceLine[] };
}

export interface InvoiceFilters {
  orgId: string;
  customerId?: string;
  status?: DisplayStatus | '';
  dueFrom?: ISODate;
  dueTo?: ISODate;
  /** Minimum whole days overdue (open invoices only). */
  minDaysOverdue?: number;
  search?: string;
  page?: number;
  pageSize?: number;
  today?: ISODate;
}

const OPEN = ['issued', 'partially_paid'];

export async function listInvoices(
  f: InvoiceFilters,
  client: SupabaseClient = supabase,
): Promise<Page<InvoiceListRow>> {
  const today = f.today ?? todayIST();
  const page = f.page ?? 0;
  const pageSize = f.pageSize ?? PAGE_SIZE;
  const [from, to] = range(page, pageSize);
  let q = client
    .from('invoices')
    .select('*, customers(name)', { count: 'exact' })
    .eq('org_id', f.orgId)
    .order('issue_date', { ascending: false })
    .order('created_at', { ascending: false })
    .range(from, to);
  if (f.customerId) q = q.eq('customer_id', f.customerId);
  if (f.dueFrom) q = q.gte('due_date', f.dueFrom);
  if (f.dueTo) q = q.lte('due_date', f.dueTo);
  if (f.minDaysOverdue !== undefined && f.minDaysOverdue > 0) {
    q = q.in('status', OPEN).lte('due_date', addDays(today, -f.minDaysOverdue));
  }
  switch (f.status) {
    case 'draft':
      q = q.eq('status', 'draft');
      break;
    case 'void':
      q = q.eq('status', 'void');
      break;
    case 'paid':
      q = q.eq('status', 'paid');
      break;
    case 'disputed':
      q = q.in('status', OPEN).eq('disputed', true);
      break;
    case 'overdue':
      q = q.in('status', OPEN).eq('disputed', false).lt('due_date', today);
      break;
    case 'part paid':
      q = q.eq('status', 'partially_paid').eq('disputed', false).gte('due_date', today);
      break;
    case 'due soon':
      q = q
        .eq('status', 'issued')
        .eq('disputed', false)
        .gte('due_date', today)
        .lte('due_date', addDays(today, DUE_SOON_DAYS));
      break;
    case 'issued':
      q = q
        .eq('status', 'issued')
        .eq('disputed', false)
        .gt('due_date', addDays(today, DUE_SOON_DAYS));
      break;
    default:
  }
  const term = f.search?.trim();
  if (term) {
    const t = likeTerm(term);
    const cust = await client
      .from('customers')
      .select('id')
      .eq('org_id', f.orgId)
      .ilike('name', `%${t}%`)
      .limit(50);
    if (cust.error) throw fromPgError(cust.error);
    const ids = (cust.data ?? []).map((c: { id: string }) => c.id);
    q = q.or(
      [`number.ilike.%${t}%`, ...(ids.length ? [`customer_id.in.(${ids.join(',')})`] : [])].join(
        ',',
      ),
    );
  }
  const res = await q;
  if (res.error) throw fromPgError(res.error);
  return { rows: (res.data ?? []) as InvoiceListRow[], total: res.count ?? 0, page, pageSize };
}

export interface TimelineEntry {
  id: string;
  created_at: string;
  action: string;
  table_name: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
}

/** Audit rows for the invoice itself and for its notes. */
export async function invoiceTimeline(
  invoiceId: string,
  client: SupabaseClient = supabase,
): Promise<TimelineEntry[]> {
  const notes = await client.from('notes').select('id').eq('invoice_id', invoiceId);
  if (notes.error) throw fromPgError(notes.error);
  const ids = [invoiceId, ...(notes.data ?? []).map((n: { id: string }) => n.id)];
  const res = await client
    .from('audit_log')
    .select('id, created_at, action, table_name, old_data, new_data')
    .in('record_id', ids)
    .in('table_name', ['invoices', 'notes'])
    .order('created_at', { ascending: true })
    .limit(200);
  if (res.error) throw fromPgError(res.error);
  return (res.data ?? []) as TimelineEntry[];
}

/** One readable sentence per audit row. */
export function describeTimelineEntry(e: TimelineEntry): string {
  const n = e.new_data ?? {};
  const o = e.old_data ?? {};
  if (e.table_name === 'notes') {
    const kind = n.note_type === 'debit' ? 'Debit note' : 'Credit note';
    if (e.action === 'INSERT') return `${kind} drafted`;
    if (o.status === 'draft' && n.status === 'issued') return `${kind} ${String(n.number)} issued`;
    return `${kind} updated`;
  }
  if (e.action === 'INSERT') {
    return n.source === 'import' ? `Imported as ${String(n.number)}` : 'Draft created';
  }
  if (o.status !== n.status) {
    if (o.status === 'draft' && n.status === 'issued') return `Issued as ${String(n.number)}`;
    return `Status changed from ${String(o.status)} to ${String(n.status)}`;
  }
  if (o.paid_paise !== n.paid_paise) return 'Payment recorded';
  if (o.disputed !== n.disputed) return n.disputed ? 'Marked disputed' : 'Dispute cleared';
  return 'Invoice edited';
}
