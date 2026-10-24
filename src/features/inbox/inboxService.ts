import type { SupabaseClient } from '@supabase/supabase-js';
import { fromPgError, updateGuarded } from '@/lib/service/errors';
import { supabase } from '@/lib/supabase';

export interface InboxInvoice {
  number: string | null;
  balance_paise: number;
}

export interface DisputeItem {
  id: string;
  invoice_id: string;
  reason: string;
  raised_via: string;
  raised_at: string;
  invoices: InboxInvoice | null;
  customers: { name: string } | null;
}

export interface ClaimItem {
  id: string;
  invoice_id: string;
  reference: string | null;
  paid_on: string | null;
  note: string | null;
  created_at: string;
  invoices: InboxInvoice | null;
  customers: { name: string } | null;
}

export interface PromiseItem {
  id: string;
  invoice_id: string;
  promised_for: string;
  promised_amount_paise: number | null;
  source: string;
  updated_at: string;
  invoices: InboxInvoice | null;
  customers: { name: string } | null;
}

export interface Inbox {
  disputes: DisputeItem[];
  claims: ClaimItem[];
  promises: PromiseItem[];
}

const EMBED = 'invoices(number, balance_paise), customers(name)';

/** Open items only, newest first, each list capped at `limit` (the page asks for more on demand). */
export async function loadInbox(
  orgId: string,
  limit: number,
  client: SupabaseClient = supabase,
): Promise<Inbox> {
  const [d, c, p] = await Promise.all([
    client
      .from('disputes')
      .select(`id, invoice_id, reason, raised_via, raised_at, ${EMBED}`)
      .eq('org_id', orgId)
      .eq('status', 'open')
      .order('raised_at', { ascending: false })
      .limit(limit),
    client
      .from('payment_claims')
      .select(`id, invoice_id, reference, paid_on, note, created_at, ${EMBED}`)
      .eq('org_id', orgId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(limit),
    client
      .from('promises')
      .select(`id, invoice_id, promised_for, promised_amount_paise, source, updated_at, ${EMBED}`)
      .eq('org_id', orgId)
      .eq('status', 'open')
      .order('promised_for', { ascending: true })
      .limit(limit),
  ]);
  for (const r of [d, c, p]) if (r.error) throw fromPgError(r.error);
  return {
    disputes: (d.data ?? []) as unknown as DisputeItem[],
    claims: (c.data ?? []) as unknown as ClaimItem[],
    promises: (p.data ?? []) as unknown as PromiseItem[],
  };
}

export async function resolveClaim(
  args: { orgId: string; claimId: string; accept: boolean; reply: string },
  client: SupabaseClient = supabase,
): Promise<void> {
  const res = await client.rpc('resolve_claim', {
    p_org: args.orgId,
    p_claim: args.claimId,
    p_accept: args.accept,
    p_reply: args.reply,
  });
  if (res.error) throw fromPgError(res.error);
}

export type DisputeOutcome = 'credit_note' | 'paid' | 'rejected';

export async function resolveDispute(
  args: { orgId: string; disputeId: string; outcome: DisputeOutcome; reply: string },
  client: SupabaseClient = supabase,
): Promise<void> {
  const res = await client.rpc('resolve_dispute', {
    p_org: args.orgId,
    p_dispute: args.disputeId,
    p_outcome: args.outcome,
    p_reply: args.reply,
  });
  if (res.error) throw fromPgError(res.error);
}

export async function setPromiseStatus(
  p: { id: string; updated_at: string },
  status: 'kept' | 'broken' | 'cancelled',
  client: SupabaseClient = supabase,
) {
  return updateGuarded(client, 'promises', p.id, p.updated_at, { status });
}

/** Counts for the nav badge. */
export async function inboxCount(
  orgId: string,
  client: SupabaseClient = supabase,
): Promise<number> {
  const heads = await Promise.all([
    client
      .from('disputes')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('status', 'open'),
    client
      .from('payment_claims')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('status', 'pending'),
  ]);
  return heads.reduce((s, r) => s + (r.count ?? 0), 0);
}
