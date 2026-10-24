import type { SupabaseClient } from '@supabase/supabase-js';
import type { TdsRow } from '@/lib/match';
import { fromPgError } from '@/lib/service/errors';
import { supabase } from '@/lib/supabase';

export interface TdsLoaded {
  row: TdsRow;
  phone: string | null;
  email: string | null;
}

const PAGE = 500;

/** All TDS entries (certificates are per quarter, so the page needs the full year), paged. */
export async function loadTdsRows(
  orgId: string,
  client: SupabaseClient = supabase,
): Promise<TdsLoaded[]> {
  const out: TdsLoaded[] = [];
  for (let p = 0; p < 10; p++) {
    const r = await client
      .from('tds_entries')
      .select(
        'id, customer_id, section, amount_paise, deducted_on, certificate_status, claimed_in_26as, customers(name, phone, email)',
      )
      .eq('org_id', orgId)
      .not('customer_id', 'is', null)
      .not('deducted_on', 'is', null)
      .order('deducted_on', { ascending: false })
      .order('id', { ascending: true })
      .range(p * PAGE, p * PAGE + PAGE - 1);
    if (r.error) throw fromPgError(r.error);
    const rows = (r.data ?? []) as unknown as {
      id: string;
      customer_id: string;
      section: string;
      amount_paise: number;
      deducted_on: string;
      certificate_status: TdsRow['certificateStatus'];
      claimed_in_26as: boolean;
      customers: { name: string; phone: string | null; email: string | null } | null;
    }[];
    for (const x of rows) {
      out.push({
        row: {
          id: x.id,
          customerId: x.customer_id,
          customerName: x.customers?.name ?? 'Customer',
          section: x.section,
          amountPaise: x.amount_paise,
          deductedOn: x.deducted_on,
          certificateStatus: x.certificate_status,
          claimedIn26as: x.claimed_in_26as,
        },
        phone: x.customers?.phone ?? null,
        email: x.customers?.email ?? null,
      });
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

export async function markCertificate(
  orgId: string,
  ids: string[],
  status: 'requested' | 'received',
  client: SupabaseClient = supabase,
): Promise<void> {
  if (!ids.length) return;
  const r = await client
    .from('tds_entries')
    .update({ certificate_status: status })
    .eq('org_id', orgId)
    .in('id', ids);
  if (r.error) throw fromPgError(r.error);
}

export async function markClaimed(
  orgId: string,
  ids: string[],
  client: SupabaseClient = supabase,
): Promise<void> {
  if (!ids.length) return;
  const r = await client
    .from('tds_entries')
    .update({ claimed_in_26as: true, claimed_at: new Date().toISOString() })
    .eq('org_id', orgId)
    .in('id', ids);
  if (r.error) throw fromPgError(r.error);
}
