import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, daysBetween, todayIST } from '@/lib/dates';
import { CREDIT_CONFIG, checkCredit, type CreditCheck } from '@/lib/credit';
import { statsOf } from '@/lib/forecast/delay';
import { validateGstin } from '@/lib/gstin';
import { scorePayability, type Payability, type PayabilityInput } from '@/lib/payability';
import { fromPgError } from '@/lib/service/errors';
import { supabase } from '@/lib/supabase';
import type { Customer } from '@/features/customers/customerService';
import type { BusinessProfile } from '@/features/settings/businessProfileService';
import type { ComputedDraft, DraftInput } from './invoiceModel';

/** Builds the pure scoring input from the form, the computed draft, the buyer and the business. */
export function payabilityInputFor(
  v: DraftInput,
  computed: ComputedDraft,
  buyer: Customer,
  profile: BusinessProfile,
  proofUploaded = false,
): PayabilityInput {
  const goods = v.lines.filter((l) => !l.hsn_sac.trim().startsWith('99'));
  return {
    buyer: {
      gstin: buyer.gstin,
      gstinValid: !!buyer.gstin && validateGstin(buyer.gstin).valid,
      stateCode: buyer.state_code,
      poRequired: buyer.po_required,
      apName: buyer.ap_name,
      apEmail: buyer.ap_email,
      apPhone: buyer.ap_phone,
    },
    placeOfSupply: computed.placeOfSupply,
    poNumber: v.poNumber?.trim() || null,
    hasGoods: goods.length > 0,
    interState: !computed.calc.intraState,
    goodsValuePaise: computed.calc.taxable,
    delivery: {
      ewayBillNo: v.ewayBillNo?.trim() || null,
      reference: v.deliveryRef?.trim() || null,
      proofUploaded,
    },
    hsnCodes: v.lines.map((l) => l.hsn_sac.trim() || null),
    turnoverPaise: profile.annual_turnover_paise,
    dueDate: computed.dueDate,
    issueDate: v.issueDate,
    creditDays: Number.isFinite(v.creditDays) ? v.creditDays : null,
    bank: { account: !!profile.bank_account_number?.trim(), upi: !!profile.upi_id?.trim() },
  };
}

export const scoreDraft = (...a: Parameters<typeof payabilityInputFor>): Payability =>
  scorePayability(payabilityInputFor(...a));

const OPEN = ['issued', 'partially_paid'];

export interface CreditContext {
  billedInWindowPaise: number;
  exposurePaise: number;
  usualDelayDays: number;
}

/** Exposure, recent billing and the usual delay (P80 days late on the last 20 paid invoices) for one customer. */
export async function loadCreditContext(
  orgId: string,
  customerId: string,
  client: SupabaseClient = supabase,
): Promise<CreditContext> {
  const since = addDays(todayIST(), -CREDIT_CONFIG.windowDays);
  const [billed, open, paid] = await Promise.all([
    client
      .from('invoices')
      .select('total_paise')
      .eq('org_id', orgId)
      .eq('customer_id', customerId)
      .in('status', [...OPEN, 'paid'])
      .gte('issue_date', since)
      .limit(2000),
    client
      .from('invoices')
      .select('balance_paise')
      .eq('org_id', orgId)
      .eq('customer_id', customerId)
      .in('status', OPEN)
      .limit(2000),
    client
      .from('invoices')
      .select('id, due_date')
      .eq('org_id', orgId)
      .eq('customer_id', customerId)
      .eq('status', 'paid')
      .order('issue_date', { ascending: false })
      .limit(20),
  ]);
  for (const r of [billed, open, paid]) if (r.error) throw fromPgError(r.error);
  const sum = (rows: unknown, k: string) =>
    ((rows ?? []) as Record<string, number>[]).reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const paidRows = (paid.data ?? []) as { id: string; due_date: string }[];
  let usual = 0;
  if (paidRows.length) {
    const ev = await client
      .from('invoice_settlements')
      .select('invoice_id, event_date')
      .eq('org_id', orgId)
      .in(
        'invoice_id',
        paidRows.map((p) => p.id),
      );
    if (ev.error) throw fromPgError(ev.error);
    const last = new Map<string, string>();
    for (const e of (ev.data ?? []) as { invoice_id: string; event_date: string }[]) {
      if (!last.has(e.invoice_id) || e.event_date > last.get(e.invoice_id)!)
        last.set(e.invoice_id, e.event_date);
    }
    const due = new Map(paidRows.map((p) => [p.id, p.due_date]));
    const samples = [...last].map(([id, d]) => daysBetween(due.get(id)!, d));
    usual = samples.length ? Math.max(Math.round(statsOf(samples).p80), 0) : 0;
  }
  return {
    billedInWindowPaise: sum(billed.data, 'total_paise'),
    exposurePaise: sum(open.data, 'balance_paise'),
    usualDelayDays: usual,
  };
}

export function creditWarning(
  ctx: CreditContext,
  buyer: Pick<Customer, 'credit_days' | 'credit_limit_paise'>,
  newInvoicePaise: number,
): CreditCheck {
  return checkCredit({
    ...ctx,
    creditDays: buyer.credit_days,
    manualLimitPaise: buyer.credit_limit_paise,
    newInvoicePaise,
  });
}
