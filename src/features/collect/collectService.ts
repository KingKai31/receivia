import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, type ISODate } from '@/lib/dates';
import { fromPgError, unwrap, updateGuarded } from '@/lib/service/errors';
import { supabase } from '@/lib/supabase';
import { DEFAULT_LADDER, STAGES, validateLadder, type LadderConfig, type Stage } from './ladder';
import { buildToday, type TodayCustomer, type TodayGroup, type TodayInvoice } from './today';
import type { BusinessProfile } from '@/features/settings/businessProfileService';
import type { Customer } from '@/features/customers/customerService';
import type { Invoice } from '@/features/invoices/invoiceService';

const PAGE = 200;
const MAX_PAGES = 5; // 1000 live invoices per load; beyond that the list says so.

export function ladderFromProfile(p: { ladder_config?: unknown }): LadderConfig {
  const raw = p.ladder_config;
  if (!raw || typeof raw !== 'object') return DEFAULT_LADDER;
  const merged = { ...DEFAULT_LADDER, ...(raw as Partial<LadderConfig>) };
  return validateLadder(merged) ? DEFAULT_LADDER : merged;
}

export async function saveLadder(
  profile: { id: string; updated_at: string },
  config: LadderConfig,
  demandLetterDays: number,
  client: SupabaseClient = supabase,
) {
  const err = validateLadder(config);
  if (err) throw new Error(err);
  if (!Number.isInteger(demandLetterDays) || demandLetterDays < 1 || demandLetterDays > 60) {
    throw new Error('Letter deadline must be between 1 and 60 days.');
  }
  return updateGuarded(client, 'business_profile', profile.id, profile.updated_at, {
    ladder_config: config,
    demand_letter_days: demandLetterDays,
  });
}

export interface TodayData {
  groups: TodayGroup[];
  truncated: boolean;
}

type ProfileRow = BusinessProfile & { ladder_config: unknown; demand_letter_days: number };
type InvoiceRow = Invoice & { accepted_on: string | null; approved_stages: Stage[] };

export async function loadToday(
  orgId: string,
  today: ISODate,
  client: SupabaseClient = supabase,
): Promise<TodayData & { profile: ProfileRow }> {
  const profile = unwrap(
    await client.from('business_profile').select('*').eq('org_id', orgId).maybeSingle(),
  ) as ProfileRow;
  const config = ladderFromProfile(profile);
  const earliest = Math.min(...STAGES.map((s) => config[s]));
  const cutoff = addDays(today, -earliest);

  const invoices: InvoiceRow[] = [];
  let truncated = false;
  for (let p = 0; p < MAX_PAGES; p++) {
    const res = await client
      .from('invoices')
      .select('*')
      .eq('org_id', orgId)
      .in('status', ['issued', 'partially_paid'])
      .lte('due_date', cutoff)
      .order('due_date', { ascending: true })
      .order('id', { ascending: true })
      .range(p * PAGE, p * PAGE + PAGE - 1);
    if (res.error) throw fromPgError(res.error);
    const rows = (res.data ?? []) as InvoiceRow[];
    invoices.push(...rows);
    if (rows.length < PAGE) break;
    if (p === MAX_PAGES - 1) truncated = true;
  }
  const ids = invoices.map((i) => i.id);
  const custIds = [...new Set(invoices.map((i) => i.customer_id))];
  const chunks = <T>(a: T[]) =>
    Array.from({ length: Math.ceil(a.length / 100) }, (_, i) => a.slice(i * 100, i * 100 + 100));

  const customers: Customer[] = [];
  const withdrawn: Record<string, string[]> = {};
  const sent: { invoice_id: string; stage: Stage }[] = [];
  const promises: { invoice_id: string; promised_for: string }[] = [];
  const pendingClaims: string[] = [];
  const dayStart = `${today}T00:00:00+05:30`;
  const dayEnd = `${addDays(today, 1)}T00:00:00+05:30`;
  const messaged: string[] = [];
  await Promise.all([
    ...chunks(custIds).map(async (c) => {
      const r = await client.from('customers').select('*').eq('org_id', orgId).in('id', c);
      if (r.error) throw fromPgError(r.error);
      customers.push(...((r.data ?? []) as Customer[]));
      // The latest consent record per customer and channel decides; "withdrawn" blocks that channel.
      const cc = await client
        .from('customer_consents')
        .select('customer_id, channel, status, created_at')
        .eq('org_id', orgId)
        .in('customer_id', c)
        .order('created_at', { ascending: false });
      if (cc.error) throw fromPgError(cc.error);
      const seen = new Set<string>();
      for (const row of (cc.data ?? []) as {
        customer_id: string;
        channel: string;
        status: string;
      }[]) {
        const key = `${row.customer_id}:${row.channel}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (row.status === 'withdrawn') (withdrawn[row.customer_id] ??= []).push(row.channel);
      }
      const m = await client
        .from('messages')
        .select('customer_id')
        .eq('org_id', orgId)
        .eq('direction', 'outbound')
        .in('customer_id', c)
        .gte('sent_at', dayStart)
        .lt('sent_at', dayEnd);
      if (m.error) throw fromPgError(m.error);
      messaged.push(...((m.data ?? []) as { customer_id: string }[]).map((x) => x.customer_id));
    }),
    ...chunks(ids).map(async (c) => {
      const r = await client
        .from('reminders')
        .select('invoice_id, stage')
        .eq('org_id', orgId)
        .eq('status', 'sent')
        .in('invoice_id', c);
      if (r.error) throw fromPgError(r.error);
      sent.push(...((r.data ?? []) as { invoice_id: string; stage: Stage }[]));
      const p = await client
        .from('promises')
        .select('invoice_id, promised_for')
        .eq('org_id', orgId)
        .eq('status', 'open')
        .in('invoice_id', c);
      if (p.error) throw fromPgError(p.error);
      promises.push(...((p.data ?? []) as { invoice_id: string; promised_for: string }[]));
      const cl = await client
        .from('payment_claims')
        .select('invoice_id')
        .eq('org_id', orgId)
        .eq('status', 'pending')
        .in('invoice_id', c);
      if (cl.error) throw fromPgError(cl.error);
      pendingClaims.push(...((cl.data ?? []) as { invoice_id: string }[]).map((x) => x.invoice_id));
    }),
  ]);

  const groups = buildToday({
    today,
    config,
    seller: profile,
    invoices: invoices.map((i): TodayInvoice => ({
      ...i,
      number: i.number ?? '',
      accepted_on: i.accepted_on,
      approved_stages: i.approved_stages ?? [],
    })),
    customers: customers.map((c) => ({
      ...c,
      consent_withdrawn: withdrawn[c.id] ?? [],
    })) as unknown as TodayCustomer[],
    sent,
    promises,
    pendingClaims,
    messagedToday: messaged,
  });
  return { groups, truncated, profile };
}

export type SendChannel = 'whatsapp' | 'email' | 'sms';

/** Creates a pay link (token stored hashed, 60 days) through the create-pay-link edge function. */
export async function createPayLink(
  invoiceId: string,
  client: SupabaseClient = supabase,
): Promise<string> {
  const res = await client.functions.invoke('create-pay-link', { body: { invoice_id: invoiceId } });
  if (res.error || !res.data?.url) throw new Error('Could not create the pay link. Try again.');
  // The function builds the URL from APP_BASE_URL; in the browser use the origin we are on.
  const token = String(res.data.url).split('/pay/')[1] ?? '';
  return `${window.location.origin}/pay/${token}`;
}

/** Logs a reminder + message atomically. Idempotent per invoice/stage/channel. */
export async function recordSend(
  args: { orgId: string; invoiceId: string; stage: Stage; channel: SendChannel; body: string },
  client: SupabaseClient = supabase,
): Promise<string> {
  const res = await client.rpc('record_send', {
    p_org: args.orgId,
    p_invoice: args.invoiceId,
    p_stage: args.stage,
    p_channel: args.channel,
    p_body: args.body,
  });
  if (res.error) throw fromPgError(res.error);
  return res.data as string;
}

export async function snoozeCustomer(
  customer: { id: string; updated_at: string },
  until: ISODate,
  client: SupabaseClient = supabase,
) {
  return updateGuarded(client, 'customers', customer.id, customer.updated_at, {
    snoozed_until: until,
  });
}

export async function promiseToPay(
  args: {
    orgId: string;
    invoiceId: string;
    customerId: string;
    date: ISODate;
    amountPaise?: number;
  },
  client: SupabaseClient = supabase,
) {
  const res = await client.from('promises').insert({
    org_id: args.orgId,
    invoice_id: args.invoiceId,
    customer_id: args.customerId,
    promised_for: args.date,
    promised_amount_paise: args.amountPaise ?? null,
    source: 'manual',
  });
  if (res.error) throw fromPgError(res.error);
}

export async function approveStage(
  invoice: { id: string; updated_at: string; approved_stages: Stage[] },
  stage: Stage,
  client: SupabaseClient = supabase,
) {
  if (invoice.approved_stages.includes(stage)) return;
  return updateGuarded(client, 'invoices', invoice.id, invoice.updated_at, {
    approved_stages: [...invoice.approved_stages, stage],
  });
}
