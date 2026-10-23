import type { SupabaseClient } from '@supabase/supabase-js';
import { fromPgError } from '@/lib/service/errors';
import { supabase } from '@/lib/supabase';
import type { CustomerImportRow, InvoiceImportRow, RowReport } from './importCore';

const CHUNK = 200;

function chunks<T>(arr: T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export interface ExistingCustomers {
  names: Set<string>;
  gstins: Set<string>;
  byName: Map<string, { id: string; state_code: string | null }>;
  byGstin: Map<string, { id: string; state_code: string | null }>;
}

/** All active customers of the org, 1000 at a time. */
export async function loadExistingCustomers(
  orgId: string,
  client: SupabaseClient = supabase,
): Promise<ExistingCustomers> {
  const out: ExistingCustomers = {
    names: new Set(),
    gstins: new Set(),
    byName: new Map(),
    byGstin: new Map(),
  };
  for (let from = 0; ; from += 1000) {
    const res = await client
      .from('customers')
      .select('id, name, gstin, state_code')
      .eq('org_id', orgId)
      .order('id')
      .range(from, from + 999);
    if (res.error) throw fromPgError(res.error);
    const rows = (res.data ?? []) as {
      id: string;
      name: string;
      gstin: string | null;
      state_code: string | null;
    }[];
    for (const r of rows) {
      const ref = { id: r.id, state_code: r.state_code };
      out.names.add(r.name.toLowerCase());
      out.byName.set(r.name.toLowerCase(), ref);
      if (r.gstin) {
        out.gstins.add(r.gstin);
        out.byGstin.set(r.gstin, ref);
      }
    }
    if (rows.length < 1000) break;
  }
  return out;
}

export async function loadExistingInvoiceNumbers(
  orgId: string,
  numbers: string[],
  client: SupabaseClient = supabase,
): Promise<Set<string>> {
  const found = new Set<string>();
  for (const part of chunks(numbers, 200)) {
    const res = await client
      .from('invoices')
      .select('number')
      .eq('org_id', orgId)
      .in('number', part);
    if (res.error) throw fromPgError(res.error);
    for (const r of (res.data ?? []) as { number: string }[]) found.add(r.number);
  }
  return found;
}

export interface CommitResult {
  imported: number;
  failed: RowReport[];
}

export async function commitCustomers(
  orgId: string,
  rows: { row: number; data: CustomerImportRow }[],
  client: SupabaseClient = supabase,
): Promise<CommitResult> {
  let imported = 0;
  const failed: RowReport[] = [];
  for (const part of chunks(rows)) {
    const res = await client
      .from('customers')
      .insert(part.map((r) => ({ org_id: orgId, ...r.data })));
    if (!res.error) {
      imported += part.length;
      continue;
    }
    // Whole chunk rejected: retry one by one so good rows still land and bad ones are named.
    for (const r of part) {
      const one = await client.from('customers').insert({ org_id: orgId, ...r.data });
      if (one.error)
        failed.push({ row: r.row, status: 'error', messages: [fromPgError(one.error).message] });
      else imported += 1;
    }
  }
  return { imported, failed };
}

/**
 * Imported invoices keep their original numbers and are marked source = 'import'. Customers
 * that do not exist yet are created from the invoice rows. They go in as issued invoices with
 * no lines (line detail is not in a sales register); payments are matched later.
 */
export async function commitInvoices(
  orgId: string,
  supplierStateCode: string,
  invoiceType: 'tax_invoice' | 'bill_of_supply' | 'invoice',
  rows: { row: number; data: InvoiceImportRow }[],
  client: SupabaseClient = supabase,
): Promise<CommitResult & { customersCreated: number }> {
  const existing = await loadExistingCustomers(orgId, client);
  const idFor = new Map<string, string>();
  const toCreate = new Map<string, { name: string; gstin: string | null }>();
  const keyOf = (name: string, gstin: string | null) =>
    gstin ? `g:${gstin}` : `n:${name.toLowerCase()}`;
  for (const { data } of rows) {
    const k = keyOf(data.customerName, data.customerGstin);
    if (idFor.has(k) || toCreate.has(k)) continue;
    const hit =
      (data.customerGstin ? existing.byGstin.get(data.customerGstin) : undefined) ??
      existing.byName.get(data.customerName.toLowerCase());
    if (hit) idFor.set(k, hit.id);
    else toCreate.set(k, { name: data.customerName, gstin: data.customerGstin });
  }
  let customersCreated = 0;
  for (const part of chunks([...toCreate.entries()])) {
    const res = await client
      .from('customers')
      .insert(
        part.map(([, c]) => ({
          org_id: orgId,
          name: c.name,
          gstin: c.gstin,
          state_code: c.gstin ? c.gstin.slice(0, 2) : null,
        })),
      )
      .select('id, name, gstin');
    if (res.error) throw fromPgError(res.error);
    for (const c of (res.data ?? []) as { id: string; name: string; gstin: string | null }[]) {
      idFor.set(keyOf(c.name, c.gstin), c.id);
      customersCreated += 1;
    }
  }

  const build = ({ data: d }: { data: InvoiceImportRow }) => ({
    org_id: orgId,
    customer_id: idFor.get(keyOf(d.customerName, d.customerGstin)),
    number: d.number,
    fy: d.fy,
    invoice_type: invoiceType,
    status: 'issued',
    issue_date: d.issue_date,
    due_date: d.due_date,
    supplier_state_code: supplierStateCode,
    place_of_supply: d.place_of_supply,
    taxable_paise: d.taxable_paise,
    cgst_paise: d.cgst_paise,
    sgst_paise: d.sgst_paise,
    igst_paise: d.igst_paise,
    round_off_paise: d.round_off_paise,
    total_paise: d.total_paise,
    source: 'import',
    source_ref: `import:${d.number}`,
  });

  let imported = 0;
  const failed: RowReport[] = [];
  for (const part of chunks(rows)) {
    const res = await client.from('invoices').insert(part.map(build));
    if (!res.error) {
      imported += part.length;
      continue;
    }
    for (const r of part) {
      const one = await client.from('invoices').insert(build(r));
      if (one.error) {
        failed.push({ row: r.row, status: 'error', messages: [fromPgError(one.error).message] });
      } else imported += 1;
    }
  }
  return { imported, failed, customersCreated };
}
