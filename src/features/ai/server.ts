import type { SupabaseClient } from '@supabase/supabase-js';
import { compute, loadForecastContext } from '@/features/forecast/forecastService';
import type { ISODate } from '@/lib/dates';
import { fromPgError } from '@/lib/service/errors';
import type { BooksSnapshot } from './books';
import type { OpenInv } from './reply';

export { askBooks } from './books';
export { classifyReply } from './reply';

/** Open (unpaid, issued) invoices of one customer, oldest due first. Org-scoped; RLS also applies for user clients. */
export async function loadOpenInvoices(
  db: SupabaseClient,
  orgId: string,
  customerId: string,
): Promise<OpenInv[]> {
  const r = await db
    .from('invoices')
    .select('id, number, balance_paise')
    .eq('org_id', orgId)
    .eq('customer_id', customerId)
    .gt('balance_paise', 0)
    .not('number', 'is', null)
    .not('status', 'in', '(draft,void,paid)')
    .order('due_date', { ascending: true })
    .limit(50);
  if (r.error) throw fromPgError(r.error);
  return ((r.data ?? []) as { id: string; number: string; balance_paise: number }[]).map((x) => ({
    id: x.id,
    number: x.number,
    balancePaise: x.balance_paise,
  }));
}

/** Everything the read-only "ask your books" tools need, for one org on one day. */
export async function loadBooks(
  db: SupabaseClient,
  orgId: string,
  today: ISODate,
): Promise<BooksSnapshot> {
  const ctx = await loadForecastContext(orgId, today, db);
  const c = compute(ctx);
  const cu = await db
    .from('customers')
    .select('id, name, state_code, tier')
    .eq('org_id', orgId)
    .limit(1000);
  if (cu.error) throw fromPgError(cu.error);
  return {
    today,
    bufferPaise: ctx.bufferPaise,
    openingBalancePaise: ctx.openingBalancePaise,
    customers: (
      (cu.data ?? []) as { id: string; name: string; state_code: string | null; tier: string }[]
    ).map((x) => ({ id: x.id, name: x.name, stateCode: x.state_code, tier: x.tier })),
    invoices: ctx.invoices,
    expenses: ctx.expenses,
    occurrences: ctx.occurrences,
    forecast: c.forecast,
  };
}
