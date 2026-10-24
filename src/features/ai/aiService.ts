import type { SupabaseClient } from '@supabase/supabase-js';
import { fromPgError } from '@/lib/service/errors';
import { supabase } from '@/lib/supabase';
import type { ISODate } from '@/lib/dates';
import type { Answer } from './books';
import { LOW_CONFIDENCE, validateReply, type Intent, type OpenInv, type ReplyResult } from './reply';

export type ReadResult = ReplyResult & { note: string };

export async function readReply(
  orgId: string,
  customerId: string,
  text: string,
  client: SupabaseClient = supabase,
): Promise<{ result: ReadResult; today: ISODate; invoices: OpenInv[] }> {
  const res = await client.functions.invoke('classify-reply', {
    body: { org_id: orgId, customer_id: customerId, text },
  });
  if (res.error) throw new Error('Could not read the reply. Try again.');
  const d = res.data as {
    result: ReadResult;
    today: ISODate;
    invoices: { id: string; number: string; balance_paise: number }[];
  };
  return {
    result: d.result,
    today: d.today,
    invoices: d.invoices.map((i) => ({
      id: i.id,
      number: i.number,
      balancePaise: i.balance_paise,
    })),
  };
}

export async function askBooksRemote(
  orgId: string,
  question: string,
  client: SupabaseClient = supabase,
): Promise<Answer> {
  const res = await client.functions.invoke('ask-books', { body: { org_id: orgId, question } });
  if (res.error) throw new Error('Could not answer that. Try again.');
  return (res.data as { answer: Answer }).answer;
}

/** What the owner has confirmed (possibly edited) and will apply. */
export interface ApplyPlan {
  intent: Intent;
  customerId: string;
  invoiceId: string | null;
  date: ISODate | null;
  amountPaise: number | null;
  reason: string | null;
}

/** Re-checks an owner-edited plan with the same rules as the first reading. Low confidence is not blocking. */
export function blockingIssues(plan: ApplyPlan, invoices: OpenInv[], today: ISODate): string[] {
  const named = invoices.find((i) => i.id === plan.invoiceId)?.number ?? null;
  const r = validateReply(
    {
      intent: plan.intent,
      date: plan.date,
      amount_rupees: plan.amountPaise === null ? null : plan.amountPaise / 100,
      invoice_number: named,
      reason: plan.reason,
      confidence: 1,
    },
    invoices,
    today,
    'rules',
  );
  return r.issues;
}

export const needsConfirm = (r: { confidence: number }) => r.confidence < LOW_CONFIDENCE;

export type Applied = 'promise' | 'dispute' | 'claim' | 'nothing' | 'exists';

/** Records the reading as a promise / dispute / payment claim. Idempotent: the same open item is not added twice. */
export async function applyReply(
  orgId: string,
  plan: ApplyPlan,
  client: SupabaseClient = supabase,
): Promise<Applied> {
  const base = { org_id: orgId, invoice_id: plan.invoiceId, customer_id: plan.customerId };
  if (plan.intent === 'question' || plan.intent === 'other' || !plan.invoiceId) return 'nothing';
  if (plan.intent === 'promise' || plan.intent === 'partial') {
    const dup = await client
      .from('promises')
      .select('id')
      .eq('org_id', orgId)
      .eq('invoice_id', plan.invoiceId)
      .eq('status', 'open')
      .eq('promised_for', plan.date!)
      .limit(1);
    if (dup.error) throw fromPgError(dup.error);
    if (dup.data?.length) return 'exists';
    const ins = await client.from('promises').insert({
      ...base,
      promised_for: plan.date,
      promised_amount_paise: plan.amountPaise,
      source: 'whatsapp',
      note:
        plan.intent === 'partial'
          ? 'Part payment promised (from a pasted reply)'
          : 'From a pasted reply',
    });
    if (ins.error) throw fromPgError(ins.error);
    return 'promise';
  }
  if (plan.intent === 'dispute') {
    const dup = await client
      .from('disputes')
      .select('id')
      .eq('org_id', orgId)
      .eq('invoice_id', plan.invoiceId)
      .eq('status', 'open')
      .limit(1);
    if (dup.error) throw fromPgError(dup.error);
    if (dup.data?.length) return 'exists';
    const ins = await client
      .from('disputes')
      .insert({ ...base, reason: plan.reason, raised_via: 'whatsapp' });
    if (ins.error) throw fromPgError(ins.error);
    return 'dispute';
  }
  const dup = await client
    .from('payment_claims')
    .select('id')
    .eq('org_id', orgId)
    .eq('invoice_id', plan.invoiceId)
    .eq('status', 'pending')
    .limit(1);
  if (dup.error) throw fromPgError(dup.error);
  if (dup.data?.length) return 'exists';
  const ins = await client.from('payment_claims').insert({
    ...base,
    paid_on: plan.date,
    amount_paise: plan.amountPaise,
    note: 'From a pasted reply',
  });
  if (ins.error) throw fromPgError(ins.error);
  return 'claim';
}
