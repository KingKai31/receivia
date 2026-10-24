import type { SupabaseClient } from '@supabase/supabase-js';
import { settledOn } from '@/lib/forecast';
import type { ForecastContext } from '@/features/forecast/forecastService';
import { addDays, daysBetween, type ISODate } from '@/lib/dates';
import { occurrences } from '@/lib/forecast';
import {
  IMPACT_CONFIG,
  msmeInterestOwed,
  replayImpact,
  roiCard,
  type OverdueForInterest,
  type ReplayInvoice,
  type ReplayResult,
  type RoiCard,
} from '@/lib/impact';
import { msmeEligibility, type SellerFacts } from '@/lib/legal';
import { fromPgError } from '@/lib/service/errors';
import { supabase } from '@/lib/supabase';

export interface ImpactData {
  replay: ReplayResult;
  roi: RoiCard;
}

/** Replay window start (also used to bound the extra queries). */
const windowStart = (today: ISODate) => addDays(today, -Math.round(IMPACT_CONFIG.months * 30.4));

/**
 * Builds the replay and ROI card for an org from the forecast context plus four small queries
 * (disputes, promises, messages sent, overdue invoices for MSMED interest).
 */
export async function loadImpact(
  orgId: string,
  ctx: ForecastContext,
  client: SupabaseClient = supabase,
): Promise<ImpactData> {
  const today = ctx.today;
  const since = windowStart(today);
  const [dis, pro, msg, prof, over] = await Promise.all([
    client
      .from('disputes')
      .select('invoice_id, raised_at, resolved_at')
      .eq('org_id', orgId)
      .gte('raised_at', since)
      .limit(1000),
    client
      .from('promises')
      .select('invoice_id, promised_for')
      .eq('org_id', orgId)
      .gte('promised_for', since)
      .limit(1000),
    client
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('direction', 'outbound')
      .gte('created_at', since),
    client
      .from('business_profile')
      .select('udyam_number, enterprise_size, activity')
      .eq('org_id', orgId)
      .maybeSingle(),
    client
      .from('invoices')
      .select(
        'issue_date, accepted_on, balance_paise, customers(credit_days, has_written_agreement)',
      )
      .eq('org_id', orgId)
      .in('status', ['issued', 'partially_paid'])
      .gt('balance_paise', 0)
      .lt('due_date', today)
      .limit(1000),
  ]);
  for (const r of [dis, pro, msg, prof, over]) if (r.error) throw fromPgError(r.error);

  const holdBy = new Map<string, number>();
  for (const d of (dis.data ?? []) as {
    invoice_id: string;
    raised_at: string;
    resolved_at: string | null;
  }[]) {
    const end = d.resolved_at ? d.resolved_at.slice(0, 10) : today;
    holdBy.set(
      d.invoice_id,
      (holdBy.get(d.invoice_id) ?? 0) + Math.max(daysBetween(d.raised_at.slice(0, 10), end), 0),
    );
  }
  const promisedBy = new Map<string, ISODate>();
  for (const p of (pro.data ?? []) as { invoice_id: string; promised_for: string }[]) {
    const cur = promisedBy.get(p.invoice_id);
    if (!cur || p.promised_for < cur) promisedBy.set(p.invoice_id, p.promised_for);
  }

  const invoices: ReplayInvoice[] = ctx.history.map((h) => {
    const paidOn = settledOn(h) ?? h.closedOn ?? null;
    const promised = promisedBy.get(h.id);
    return {
      id: h.id,
      issueDate: h.issueDate,
      dueDate: h.dueDate,
      totalPaise: h.totalPaise,
      paidOn,
      holdDays: holdBy.get(h.id),
      promiseSlipDays: promised && paidOn && paidOn > promised ? daysBetween(promised, paidOn) : 0,
    };
  });
  const replay = replayImpact({
    asOf: today,
    invoices,
    outflows: occurrences(ctx.expenses, since, today).map((o) => ({
      date: o.date,
      amountPaise: o.amountPaise,
    })),
    endingBalancePaise: ctx.openingBalancePaise,
    bufferPaise: ctx.bufferPaise,
  });

  const seller = (prof.data ?? {
    udyam_number: null,
    enterprise_size: null,
    activity: null,
  }) as SellerFacts;
  const overdue: OverdueForInterest[] = (
    (over.data ?? []) as unknown as {
      issue_date: string;
      accepted_on: string | null;
      balance_paise: number;
      customers: { credit_days: number; has_written_agreement: boolean } | null;
    }[]
  ).map((r) => ({
    balancePaise: r.balance_paise,
    acceptedOn: r.accepted_on ?? r.issue_date,
    creditDays: r.customers?.credit_days ?? 30,
    hasWrittenAgreement: r.customers?.has_written_agreement ?? false,
  }));
  const interest = msmeInterestOwed(overdue, today, msmeEligibility(seller).applies);
  return {
    replay,
    roi: roiCard({ messagesAutomated: msg.count ?? 0, replay, msmeInterestPaise: interest }),
  };
}
