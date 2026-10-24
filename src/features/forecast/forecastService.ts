import type { SupabaseClient } from '@supabase/supabase-js';
import { STAGES } from '@/features/collect/ladder';
import { addDays, type ISODate } from '@/lib/dates';
import {
  FORECAST_CONFIG,
  buildDelayModels,
  chaseScores,
  delaySamples,
  occurrences,
  simulate,
  solveGap,
  type CustomerInfo,
  type DelayModels,
  type EntityKind,
  type Expense,
  type Forecast,
  type HistInvoice,
  type ChaseItem,
  type ForecastInput,
  type GapPlan,
  type OpenInvoice,
  type Occurrence,
} from '@/lib/forecast';
import { fromPgError, updateGuarded } from '@/lib/service/errors';
import { supabase } from '@/lib/supabase';

const PAGE = 1000;
const HISTORY_DAYS = 400;

export interface ForecastContext {
  today: ISODate;
  openingBalancePaise: number;
  openingBalanceOn: ISODate | null;
  bufferPaise: number;
  profile: { id: string; updated_at: string };
  customers: CustomerInfo[];
  invoices: OpenInvoice[];
  history: HistInvoice[];
  expenses: Expense[];
  models: DelayModels;
  occurrences: Occurrence[];
  /** True when a list hit its cap and the numbers may be incomplete. */
  truncated: boolean;
}

async function pages<T>(
  run: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown[] | null; error: { code?: string; message?: string } | null }>,
  maxPages = 10,
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  for (let p = 0; p < maxPages; p++) {
    const r = await run(p * PAGE, p * PAGE + PAGE - 1);
    if (r.error) throw fromPgError(r.error);
    const got = (r.data ?? []) as T[];
    rows.push(...got);
    if (got.length < PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

const chunks = <T>(a: T[], n = 100) =>
  Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

export function expenseFromRow(r: ExpenseRow): Expense {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    amountPaise: r.amount_paise,
    expenseDate: r.expense_date,
    isRecurring: r.is_recurring,
    recurrence: r.recurrence,
    nextDue: r.next_due,
    endsOn: r.ends_on,
    active: r.active,
    deferrable: r.can_defer,
  };
}

export interface ExpenseRow {
  id: string;
  name: string;
  kind: string;
  category: string | null;
  amount_paise: number;
  expense_date: string;
  is_recurring: boolean;
  recurrence: 'weekly' | 'monthly' | 'quarterly' | 'yearly' | null;
  next_due: string | null;
  ends_on: string | null;
  active: boolean;
  can_defer: boolean;
  updated_at: string;
}

export async function loadForecastContext(
  orgId: string,
  today: ISODate,
  client: SupabaseClient = supabase,
): Promise<ForecastContext> {
  const prof = await client
    .from('business_profile')
    .select('id, updated_at, opening_balance_paise, opening_balance_on, safety_buffer_paise')
    .eq('org_id', orgId)
    .maybeSingle();
  if (prof.error) throw fromPgError(prof.error);
  const p = prof.data as {
    id: string;
    updated_at: string;
    opening_balance_paise: number;
    opening_balance_on: string | null;
    safety_buffer_paise: number;
  } | null;
  if (!p) throw new Error('Business profile not found.');

  const since = addDays(today, -HISTORY_DAYS);
  const [openR, histR, evR, custR, expR] = await Promise.all([
    pages<{
      id: string;
      number: string | null;
      customer_id: string;
      due_date: string;
      balance_paise: number;
      disputed: boolean;
    }>(
      (a, b) =>
        client
          .from('invoices')
          .select('id, number, customer_id, due_date, balance_paise, disputed')
          .eq('org_id', orgId)
          .in('status', ['issued', 'partially_paid'])
          .gt('balance_paise', 0)
          .order('due_date', { ascending: true })
          .order('id', { ascending: true })
          .range(a, b),
      5,
    ),
    pages<{
      id: string;
      customer_id: string;
      issue_date: string;
      due_date: string;
      total_paise: number;
      status: string;
    }>(
      (a, b) =>
        client
          .from('invoices')
          .select('id, customer_id, issue_date, due_date, total_paise, status')
          .eq('org_id', orgId)
          .neq('status', 'draft')
          .neq('status', 'void')
          .gte('issue_date', since)
          .order('issue_date', { ascending: true })
          .order('id', { ascending: true })
          .range(a, b),
      10,
    ),
    pages<{ invoice_id: string; event_date: string; event_paise: number }>(
      (a, b) =>
        client
          .from('invoice_settlements')
          .select('invoice_id, event_date, event_paise')
          .eq('org_id', orgId)
          .gte('event_date', since)
          .order('event_date', { ascending: true })
          .order('invoice_id', { ascending: true })
          .range(a, b),
      20,
    ),
    pages<{ id: string; name: string; entity_type: EntityKind; credit_days: number }>(
      (a, b) =>
        client
          .from('customers')
          .select('id, name, entity_type, credit_days')
          .eq('org_id', orgId)
          .is('archived_at', null)
          .order('name')
          .order('id')
          .range(a, b),
      5,
    ),
    pages<ExpenseRow>(
      (a, b) =>
        client
          .from('expenses')
          .select('*')
          .eq('org_id', orgId)
          .eq('active', true)
          .order('expense_date', { ascending: true })
          .order('id', { ascending: true })
          .range(a, b),
      5,
    ),
  ]);

  // Reminder stage and open promise per open invoice.
  const ids = openR.rows.map((r) => r.id);
  const stageOf = new Map<string, string>();
  const promiseOf = new Map<string, string>();
  await Promise.all(
    chunks(ids).map(async (c) => {
      const [rem, pro] = await Promise.all([
        client
          .from('reminders')
          .select('invoice_id, stage')
          .eq('org_id', orgId)
          .eq('status', 'sent')
          .in('invoice_id', c),
        client
          .from('promises')
          .select('invoice_id, promised_for')
          .eq('org_id', orgId)
          .eq('status', 'open')
          .gte('promised_for', today)
          .in('invoice_id', c),
      ]);
      if (rem.error) throw fromPgError(rem.error);
      if (pro.error) throw fromPgError(pro.error);
      for (const r of (rem.data ?? []) as { invoice_id: string; stage: string }[]) {
        const cur = stageOf.get(r.invoice_id);
        if (
          !cur ||
          STAGES.indexOf(r.stage as (typeof STAGES)[number]) >
            STAGES.indexOf(cur as (typeof STAGES)[number])
        ) {
          stageOf.set(r.invoice_id, r.stage);
        }
      }
      for (const r of (pro.data ?? []) as { invoice_id: string; promised_for: string }[]) {
        const cur = promiseOf.get(r.invoice_id);
        if (!cur || r.promised_for > cur) promiseOf.set(r.invoice_id, r.promised_for);
      }
    }),
  );

  const invoices: OpenInvoice[] = openR.rows.map((r) => ({
    id: r.id,
    number: r.number ?? undefined,
    customerId: r.customer_id,
    dueDate: r.due_date,
    balancePaise: r.balance_paise,
    disputed: r.disputed,
    stage: stageOf.get(r.id) ?? null,
    promisedFor: promiseOf.get(r.id) ?? null,
  }));

  const eventsBy = new Map<string, { date: string; amountPaise: number }[]>();
  for (const e of evR.rows) {
    const l = eventsBy.get(e.invoice_id) ?? [];
    l.push({ date: e.event_date, amountPaise: e.event_paise });
    eventsBy.set(e.invoice_id, l);
  }
  const history: HistInvoice[] = histR.rows.map((r) => {
    const events = eventsBy.get(r.id) ?? [];
    return {
      id: r.id,
      customerId: r.customer_id,
      issueDate: r.issue_date,
      dueDate: r.due_date,
      totalPaise: r.total_paise,
      events,
      closedOn: r.status === 'paid' && events.length ? events[events.length - 1]!.date : null,
    };
  });

  const customers: CustomerInfo[] = custR.rows.map((c) => ({
    id: c.id,
    name: c.name,
    entityType: c.entity_type,
    creditDays: c.credit_days,
  }));
  const expenses = expR.rows.map(expenseFromRow);
  const horizonEnd = addDays(today, FORECAST_CONFIG.weeks * 7 - 1);
  return {
    today,
    openingBalancePaise: p.opening_balance_paise,
    openingBalanceOn: p.opening_balance_on,
    bufferPaise: p.safety_buffer_paise,
    profile: { id: p.id, updated_at: p.updated_at },
    customers,
    invoices,
    history,
    expenses,
    models: buildDelayModels(delaySamples(history)),
    occurrences: occurrences(expenses, today, horizonEnd),
    truncated:
      openR.truncated || histR.truncated || evR.truncated || custR.truncated || expR.truncated,
  };
}

export function toInput(ctx: ForecastContext, includeDisputed = false): ForecastInput {
  return {
    today: ctx.today,
    openingBalancePaise: ctx.openingBalancePaise,
    bufferPaise: ctx.bufferPaise,
    invoices: ctx.invoices,
    customers: ctx.customers,
    models: ctx.models,
    occurrences: ctx.occurrences,
    includeDisputed,
  };
}

export interface Computed {
  forecast: Forecast;
  plan: GapPlan | null;
  chase: ChaseItem[];
}

/** Forecast, solver plan and chase ranking from one loaded context. Pure and repeatable. */
export function compute(ctx: ForecastContext, opts: { includeDisputed?: boolean } = {}): Computed {
  const input = toInput(ctx, opts.includeDisputed);
  const forecast = simulate(input);
  const plan = solveGap({
    today: ctx.today,
    forecast,
    invoices: ctx.invoices,
    customers: ctx.customers,
    models: ctx.models,
    occurrences: ctx.occurrences,
  });
  const chase = chaseScores({
    today: ctx.today,
    forecast,
    invoices: ctx.invoices,
    customers: ctx.customers,
    models: ctx.models,
  });
  return { forecast, plan, chase };
}

export async function saveForecastSettings(
  profile: { id: string; updated_at: string },
  patch: {
    opening_balance_paise: number;
    opening_balance_on: string | null;
    safety_buffer_paise: number;
  },
  client: SupabaseClient = supabase,
) {
  return updateGuarded(client, 'business_profile', profile.id, profile.updated_at, patch);
}
