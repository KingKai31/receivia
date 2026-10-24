import type { SupabaseClient } from '@supabase/supabase-js';
import {
  dedupeKeys,
  sha256Hex,
  suggestMatches,
  type BankLine,
  type EntityKind,
  type MatchCustomer,
  type OpenInvoice,
  type Suggestion,
} from '@/lib/match';
import { paise } from '@/lib/money';
import { fromPgError } from '@/lib/service/errors';
import { supabase } from '@/lib/supabase';

const CHUNK = 200;

export interface ImportResult {
  added: number;
  skipped: number;
}

/** Inserts statement lines; lines already imported (same date, amount, reference) are skipped. */
export async function importBankLines(
  orgId: string,
  lines: BankLine[],
  client: SupabaseClient = supabase,
): Promise<ImportResult> {
  const keys = dedupeKeys(lines);
  const hashes = await Promise.all(keys.map(sha256Hex));
  let added = 0;
  for (let i = 0; i < lines.length; i += CHUNK) {
    const rows = lines.slice(i, i + CHUNK).map((l, k) => ({
      org_id: orgId,
      txn_date: l.date,
      description: l.description,
      direction: l.creditPaise > 0 ? 'credit' : 'debit',
      amount_paise: l.creditPaise > 0 ? l.creditPaise : l.debitPaise,
      reference: l.reference || null,
      dedupe_hash: hashes[i + k]!,
      status: l.creditPaise > 0 ? 'unmatched' : 'ignored',
    }));
    const res = await client
      .from('bank_txns')
      .upsert(rows, { onConflict: 'org_id,dedupe_hash', ignoreDuplicates: true })
      .select('id');
    if (res.error) throw fromPgError(res.error);
    added += res.data?.length ?? 0;
  }
  return { added, skipped: lines.length - added };
}

export interface BankSuggestion extends Suggestion {
  txnId: string;
}

interface TxnRow {
  id: string;
  txn_date: string;
  description: string | null;
  amount_paise: number;
  reference: string | null;
}

/** Unmatched deposits with a suggestion each. Suggestions are advice only; nothing is applied here. */
export async function loadSuggestions(
  orgId: string,
  limit: number,
  client: SupabaseClient = supabase,
): Promise<BankSuggestion[]> {
  const txns = await client
    .from('bank_txns')
    .select('id, txn_date, description, amount_paise, reference')
    .eq('org_id', orgId)
    .eq('status', 'unmatched')
    .eq('direction', 'credit')
    .order('txn_date', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit);
  if (txns.error) throw fromPgError(txns.error);
  const rows = (txns.data ?? []) as TxnRow[];
  if (!rows.length) return [];

  const invoices: OpenInvoice[] = [];
  for (let p = 0; p < 5; p++) {
    const r = await client
      .from('invoices')
      .select('id, number, customer_id, balance_paise, taxable_paise, issue_date, due_date')
      .eq('org_id', orgId)
      .in('status', ['issued', 'partially_paid'])
      .gt('balance_paise', 0)
      .order('due_date', { ascending: true })
      .order('id', { ascending: true })
      .range(p * 200, p * 200 + 199);
    if (r.error) throw fromPgError(r.error);
    const page = (r.data ?? []) as {
      id: string;
      number: string | null;
      customer_id: string;
      balance_paise: number;
      taxable_paise: number;
      issue_date: string;
      due_date: string;
    }[];
    for (const i of page) {
      invoices.push({
        id: i.id,
        number: i.number ?? '',
        customerId: i.customer_id,
        balancePaise: i.balance_paise,
        taxablePaise: i.taxable_paise,
        issueDate: i.issue_date,
        dueDate: i.due_date,
      });
    }
    if (page.length < 200) break;
  }
  const custIds = [...new Set(invoices.map((i) => i.customerId))];
  const customers: MatchCustomer[] = [];
  for (let i = 0; i < custIds.length; i += 100) {
    const c = await client
      .from('customers')
      .select('id, name, entity_type')
      .eq('org_id', orgId)
      .in('id', custIds.slice(i, i + 100));
    if (c.error) throw fromPgError(c.error);
    for (const x of (c.data ?? []) as { id: string; name: string; entity_type: EntityKind }[]) {
      customers.push({ id: x.id, name: x.name, entityType: x.entity_type });
    }
  }
  const lines: BankLine[] = rows.map((r) => ({
    date: r.txn_date,
    description: r.description ?? '',
    creditPaise: paise(r.amount_paise),
    debitPaise: paise(0),
    reference: r.reference ?? '',
  }));
  return suggestMatches(lines, invoices, customers).map((s, i) => ({ ...s, txnId: rows[i]!.id }));
}

/** The owner has confirmed: payment, allocations and any TDS entry in one transaction. */
export async function confirmSuggestion(
  orgId: string,
  s: BankSuggestion,
  client: SupabaseClient = supabase,
): Promise<void> {
  const res = await client.rpc('confirm_bank_match', {
    p_org: orgId,
    p_txn: s.txnId,
    p_customer: s.customerId,
    p_alloc: s.allocations.map((a) => ({ invoice_id: a.invoiceId, amount_paise: a.amountPaise })),
    p_tds: s.tds
      ? {
          section: s.tds.section,
          rate: s.tds.ratePct,
          amount_paise: s.tds.amountPaise,
          invoice_id: s.tdsInvoiceId,
          taxable_paise: s.tds.taxablePaise,
        }
      : null,
  });
  if (res.error) throw fromPgError(res.error);
}

export async function ignoreTxn(
  orgId: string,
  txnId: string,
  client: SupabaseClient = supabase,
): Promise<void> {
  const res = await client
    .from('bank_txns')
    .update({ status: 'ignored' })
    .eq('org_id', orgId)
    .eq('id', txnId);
  if (res.error) throw fromPgError(res.error);
}

export interface PaymentRow {
  id: string;
  amount_paise: number;
  received_on: string;
  method: string;
  reference: string | null;
  source: string;
  customers: { name: string } | null;
}

export async function listPayments(
  orgId: string,
  limit: number,
  client: SupabaseClient = supabase,
): Promise<PaymentRow[]> {
  const r = await client
    .from('payments')
    .select('id, amount_paise, received_on, method, reference, source, customers(name)')
    .eq('org_id', orgId)
    .order('received_on', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);
  if (r.error) throw fromPgError(r.error);
  return (r.data ?? []) as unknown as PaymentRow[];
}
