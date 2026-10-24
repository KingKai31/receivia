import type { SupabaseClient } from '@supabase/supabase-js';
import { todayIST, type ISODate } from '@/lib/dates';
import { fromPgError, unwrap, updateGuarded } from '@/lib/service/errors';
import { supabase } from '@/lib/supabase';
import { recordSend } from '@/features/collect/collectService';
import type { Stage } from '@/features/collect/ladder';

export interface AgentAction {
  id: string;
  updated_at: string;
  invoice_id: string | null;
  customer_id: string | null;
  action_type: 'send_reminder' | 'owner_task';
  status: 'proposed' | 'approved' | 'sent' | 'failed' | 'skipped' | 'rejected';
  stage: string | null;
  channel: 'email' | 'whatsapp' | null;
  priority: number;
  reasoning: string | null;
  subject: string | null;
  body_template: string | null;
  draft_source: 'ai' | 'template' | null;
  draft_note: string | null;
  approver: string | null;
  decision_log: { at: string; by: string; decision: string; note: string }[];
  error: string | null;
  attempts: number;
  wa_url: string | null;
  payload: {
    customer?: string;
    invoice_no?: string;
    amount_due_paise?: number;
    days_overdue?: number;
  };
  run_date: ISODate;
}

export interface AgentSettingsRow {
  id: string;
  updated_at: string;
  autonomy_level: 0 | 1 | 2;
  channels: ('email' | 'whatsapp')[];
  quiet_start_hour: number;
  quiet_end_hour: number;
  test_mode: boolean;
  demo_date: string | null;
  owner_email: string | null;
  owner_language: 'en' | 'hi' | 'mr';
}

export async function loadAgentSettings(orgId: string, client: SupabaseClient = supabase) {
  return unwrap(
    await client.from('business_profile').select('*').eq('org_id', orgId).maybeSingle(),
  ) as AgentSettingsRow;
}

export async function saveAgentSettings(
  row: { id: string; updated_at: string },
  patch: Partial<Omit<AgentSettingsRow, 'id' | 'updated_at'>>,
  client: SupabaseClient = supabase,
) {
  if (
    patch.quiet_start_hour !== undefined &&
    !(patch.quiet_start_hour >= 0 && patch.quiet_start_hour <= 23)
  )
    throw new Error('Quiet hours must be hours between 0 and 23.');
  if (patch.demo_date) todayIST(new Date(`${patch.demo_date}T00:00:00+05:30`));
  return updateGuarded(client, 'business_profile', row.id, row.updated_at, patch);
}

/** The agent's actions for the current plan day (demo date if set, else today in IST). */
export async function loadActions(
  orgId: string,
  day: ISODate,
  client: SupabaseClient = supabase,
): Promise<AgentAction[]> {
  const r = await client
    .from('agent_actions')
    .select('*')
    .eq('org_id', orgId)
    .eq('run_date', day)
    .order('priority', { ascending: true })
    .limit(300);
  if (r.error) throw fromPgError(r.error);
  return (r.data ?? []) as AgentAction[];
}

export async function loadLastRun(orgId: string, client: SupabaseClient = supabase) {
  const r = await client
    .from('agent_runs')
    .select('id, status, trigger, started_at, finished_at, steps')
    .eq('org_id', orgId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (r.error) throw fromPgError(r.error);
  return r.data as {
    id: string;
    status: string;
    trigger: string;
    started_at: string;
    finished_at: string | null;
    steps: { step: string; ok: boolean; attempts: number; error?: string }[];
  } | null;
}

async function invokeAgent(body: Record<string, unknown>, client: SupabaseClient) {
  const res = await client.functions.invoke('agent-run', { body });
  if (res.error) throw new Error('The agent could not run. Try again.');
  return res.data as Record<string, unknown>;
}

export const runAgentNow = (orgId: string, client: SupabaseClient = supabase) =>
  invokeAgent({ org_id: orgId, step: 'all' }, client);

export async function decide(
  a: AgentAction,
  decision: 'approved' | 'rejected',
  userId: string,
  client: SupabaseClient = supabase,
) {
  const by = `owner:${userId}`;
  return updateGuarded(client, 'agent_actions', a.id, a.updated_at, {
    status: decision,
    approver: by,
    decided_by: userId,
    decided_at: new Date().toISOString(),
    decision_log: [
      ...a.decision_log,
      { at: new Date().toISOString(), by, decision, note: 'Decided in the app.' },
    ],
  });
}

/** Approves one action and sends it straight away. */
export async function approveAndSend(
  orgId: string,
  a: AgentAction,
  userId: string,
  client: SupabaseClient = supabase,
) {
  await decide(a, 'approved', userId, client);
  return invokeAgent({ org_id: orgId, step: 'send', action_ids: [a.id] }, client);
}

export async function retryAction(
  orgId: string,
  a: AgentAction,
  userId: string,
  client: SupabaseClient = supabase,
) {
  await updateGuarded(client, 'agent_actions', a.id, a.updated_at, {
    status: 'approved',
    error: null,
    decision_log: [
      ...a.decision_log,
      {
        at: new Date().toISOString(),
        by: `owner:${userId}`,
        decision: 'retry',
        note: 'Retry from Today.',
      },
    ],
  });
  return invokeAgent({ org_id: orgId, step: 'send', action_ids: [a.id] }, client);
}

/** WhatsApp is sent by the owner from the wa.me link; this records it as sent. */
export async function markWhatsappSent(
  orgId: string,
  a: AgentAction,
  userId: string,
  client: SupabaseClient = supabase,
) {
  const text = a.wa_url ? decodeURIComponent(a.wa_url.split('?text=')[1] ?? '') : '';
  if (!a.invoice_id || !a.stage || !text) throw new Error('Nothing to record for this action.');
  await recordSend(
    { orgId, invoiceId: a.invoice_id, stage: a.stage as Stage, channel: 'whatsapp', body: text },
    client,
  );
  const by = `owner:${userId}`;
  return updateGuarded(client, 'agent_actions', a.id, a.updated_at, {
    status: 'sent',
    executed_at: new Date().toISOString(),
    decision_log: [
      ...a.decision_log,
      {
        at: new Date().toISOString(),
        by,
        decision: 'sent',
        note: 'Sent by the owner on WhatsApp.',
      },
    ],
  });
}

/** Public approve-all page: preview or confirm with the signed token from the brief. */
export async function approveByToken(token: string, confirm: boolean) {
  const res = await supabase.functions.invoke('approve-actions', { body: { t: token, confirm } });
  if (res.error) throw new Error('This approval link is invalid or has expired.');
  return res.data as {
    pending?: number;
    business?: string;
    day?: string;
    test_mode?: boolean;
    approved?: number;
  };
}
