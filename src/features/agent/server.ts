import type { SupabaseClient } from '@supabase/supabase-js';
import { loadToday } from '@/features/collect/collectService';
import { buildSlotValues, type TodayGroup } from '@/features/collect/today';
import {
  renderTemplate,
  whatsappUrl,
  type Lang,
  type MessageStage,
} from '@/features/collect/templates';
import { compute, loadForecastContext } from '@/features/forecast/forecastService';
import { rankGroups } from '@/features/collect/rank';
import { firstShortfall } from '@/lib/forecast';
import { todayIST, type ISODate } from '@/lib/dates';
import { buildBrief, signApproval, verifyApproval } from './brief';
import { draftMessage, templateDraft, toneFor, type CustomerHistory } from './draft';
import {
  existingKey,
  inQuiet,
  planActions,
  type AgentSettings,
  type Autonomy,
  type Channel,
} from './planner';

/** Everything the server side of the agent needs from the environment. No Deno or Node globals. */
export interface AgentEnv {
  anthropicKey?: string | null;
  resendKey?: string | null;
  whatsappToken?: string | null;
  whatsappPhoneId?: string | null;
  appBaseUrl: string;
  functionsUrl: string;
  signingSecret: string;
  fromEmail?: string;
  now?: Date;
  fetchImpl?: typeof fetch;
}

export const MAX_AI_DRAFTS_PER_RUN = 25;
export const APPROVAL_TTL_SECONDS = 48 * 3600;

type Db = SupabaseClient;
interface Profile {
  org_id: string;
  legal_name: string;
  phone: string | null;
  autonomy_level: Autonomy;
  channels: Channel[];
  quiet_start_hour: number;
  quiet_end_hour: number;
  test_mode: boolean;
  demo_date: string | null;
  owner_email: string | null;
  owner_language: Lang;
  [k: string]: unknown;
}

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

export async function loadProfile(db: Db, orgId: string): Promise<Profile> {
  const p = must(
    await db.from('business_profile').select('*').eq('org_id', orgId).maybeSingle(),
    'profile',
  ) as Profile | null;
  if (!p) throw new Error('profile: not found');
  return p;
}

export function settingsOf(p: Profile): AgentSettings {
  return {
    autonomy: p.autonomy_level,
    channels: p.channels,
    quietStart: p.quiet_start_hour,
    quietEnd: p.quiet_end_hour,
    testMode: p.test_mode,
  };
}

export function planDay(p: Profile, now: Date): ISODate {
  return (p.demo_date as ISODate | null) ?? todayIST(now);
}

export async function ownerEmail(db: Db, p: Profile): Promise<string | null> {
  if (p.owner_email) return p.owner_email;
  const m = await db
    .from('memberships')
    .select('user_id')
    .eq('org_id', p.org_id)
    .eq('role', 'owner')
    .limit(1)
    .maybeSingle();
  const uid = (m.data as { user_id: string } | null)?.user_id;
  if (!uid) return null;
  const u = await db.auth.admin.getUserById(uid);
  return u.data.user?.email ?? null;
}

export async function listOrgs(db: Db): Promise<string[]> {
  const r = must(await db.from('business_profile').select('org_id'), 'orgs') as {
    org_id: string;
  }[];
  return r.map((x) => x.org_id);
}

async function chaseFor(db: Db, orgId: string, today: ISODate) {
  try {
    const ctx = await loadForecastContext(orgId, today, db);
    const c = compute(ctx);
    const history = new Map<string, CustomerHistory>();
    for (const [id, d] of ctx.models.byCustomer) {
      if (d.n === 0 || d.samples.length === 0) continue;
      history.set(id, {
        n: d.n,
        onTimePct: (d.samples.filter((x) => x <= 0).length / d.samples.length) * 100,
        avgDelayDays: d.samples.reduce((a, b) => a + b, 0) / d.samples.length,
      });
    }
    return { chase: c.chase, shortfallWeek: firstShortfall(c.forecast)?.week ?? null, history };
  } catch {
    return {
      chase: [],
      shortfallWeek: null as number | null,
      history: new Map<string, CustomerHistory>(),
    };
  }
}

async function ranked(db: Db, orgId: string, today: ISODate) {
  const data = await loadToday(orgId, today, db);
  const f = await chaseFor(db, orgId, today);
  return {
    ...data,
    groups: rankGroups(data.groups, f.chase),
    shortfallWeek: f.shortfallWeek,
    history: f.history,
  };
}

// ---- Plan ------------------------------------------------------------------------------------

export interface PlanResult {
  date: ISODate;
  planned: number;
  proposed: number;
  autoApproved: number;
  skipped: number;
  ownerTasks: number;
  aiDrafts: number;
  templateDrafts: number;
  superseded: number;
}

export async function runPlan(db: Db, orgId: string, env: AgentEnv): Promise<PlanResult> {
  const now = env.now ?? new Date();
  const p = await loadProfile(db, orgId);
  const today = planDay(p, now);
  const nowIso = now.toISOString();

  // Yesterday's (or another demo day's) unsent plan is stale: the ladder is re-evaluated from facts.
  const stale = must(
    await db
      .from('agent_actions')
      .select('id, decision_log')
      .eq('org_id', orgId)
      .in('status', ['proposed', 'approved'])
      .neq('run_date', today),
    'stale',
  ) as { id: string; decision_log: unknown[] }[];
  for (const s of stale) {
    await db
      .from('agent_actions')
      .update({
        status: 'skipped',
        draft_note: 'Superseded by a newer plan.',
        decision_log: [
          ...s.decision_log,
          { at: nowIso, by: 'planner', decision: 'skipped', note: 'Superseded by a newer plan.' },
        ],
      })
      .eq('id', s.id);
  }

  const { groups, history } = await ranked(db, orgId, today);
  const ex = must(
    await db
      .from('agent_actions')
      .select('invoice_id, stage, action_type')
      .eq('org_id', orgId)
      .eq('run_date', today),
    'existing',
  ) as { invoice_id: string; stage: string; action_type: string }[];
  const existing = new Set(ex.map((e) => existingKey(e.invoice_id, e.stage, e.action_type)));

  const pr = must(
    await db
      .from('promises')
      .select('invoice_id, customer_id, invoices(number), customers(name)')
      .eq('org_id', orgId)
      .eq('status', 'open')
      .eq('promised_for', today),
    'promises',
  ) as unknown as {
    invoice_id: string;
    customer_id: string;
    invoices: { number: string } | null;
    customers: { name: string } | null;
  }[];

  const planned = planActions({
    groups,
    settings: settingsOf(p),
    today,
    seller: p as never,
    existing,
    promisesDueToday: pr.map((x) => ({
      invoice_id: x.invoice_id,
      customer_id: x.customer_id,
      customer: x.customers?.name ?? 'Customer',
      invoice_no: x.invoices?.number ?? '',
    })),
    nowIso,
  });

  const res: PlanResult = {
    date: today,
    planned: 0,
    proposed: 0,
    autoApproved: 0,
    skipped: 0,
    ownerTasks: 0,
    aiDrafts: 0,
    templateDrafts: 0,
    superseded: stale.length,
  };
  const byInvoice = new Map<string, TodayGroup>(groups.map((g) => [g.primary.invoice.id, g]));
  for (const a of planned) {
    let subject: string | null = null;
    let body: string | null = null;
    let source: 'ai' | 'template' | null = null;
    let note: string | null = null;
    if (a.action_type === 'send_reminder' && a.status !== 'skipped') {
      const g = byInvoice.get(a.invoice_id)!;
      const d = await db
        .from('disputes')
        .select('reason')
        .eq('org_id', orgId)
        .eq('invoice_id', a.invoice_id)
        .order('raised_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const customerText = (d.data as { reason: string } | null)?.reason ?? null;
      const useAi = res.aiDrafts < MAX_AI_DRAFTS_PER_RUN;
      const dr = useAi
        ? await draftMessage(
            {
              stage: a.stage as MessageStage,
              language: g.customer.language,
              tier: g.customer.tier,
              lensAllowed: a.lensAllowed,
              business: p.legal_name,
              customerText,
              history: history.get(g.customer.id) ?? null,
              openDispute: customerText !== null,
            },
            { anthropicKey: env.anthropicKey, fetchImpl: env.fetchImpl },
          )
        : {
            ...templateDraft(a.stage as MessageStage, g.customer.language),
            source: 'template' as const,
            note: 'draft cap reached: template',
            why: toneFor({
              stage: a.stage as MessageStage,
              language: g.customer.language,
              tier: g.customer.tier,
              lensAllowed: false,
              business: p.legal_name,
              history: history.get(g.customer.id) ?? null,
            }).why,
          };
      subject = dr.subject;
      body = dr.body;
      source = dr.source;
      note = `${dr.note}. ${dr.why}`;
      if (dr.source === 'ai') res.aiDrafts++;
      else res.templateDrafts++;
    }
    const ins = await db.from('agent_actions').insert({
      org_id: orgId,
      invoice_id: a.invoice_id,
      customer_id: a.customer_id,
      action_type: a.action_type,
      status: a.status,
      reasoning: a.reasoning,
      payload: a.payload,
      policy_checks: a.policy_checks,
      run_date: today,
      stage: a.stage,
      channel: a.channel,
      priority: a.priority,
      subject,
      body_template: body,
      draft_source: source,
      draft_note: note,
      approver: a.approver,
      decision_log: a.decision_log,
      decided_at: a.approver ? nowIso : null,
    });
    if (ins.error) {
      if (ins.error.code === '23505') continue; // already planned: idempotent
      throw new Error(`insert action: ${ins.error.message}`);
    }
    res.planned++;
    if (a.action_type === 'owner_task') res.ownerTasks++;
    else if (a.status === 'approved') res.autoApproved++;
    else if (a.status === 'skipped') res.skipped++;
    else res.proposed++;
  }
  return res;
}

// ---- Send ------------------------------------------------------------------------------------

export interface SendResult {
  sent: number;
  failed: number;
  deferred: number;
  waitingWhatsapp: number;
  skipped: number;
}

interface ActionRow {
  id: string;
  invoice_id: string;
  customer_id: string;
  stage: string;
  channel: Channel;
  subject: string | null;
  body_template: string | null;
  approver: string | null;
  attempts: number;
  decision_log: unknown[];
  wa_url: string | null;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Mints a pay token with the service role (create_pay_token needs a signed-in user). */
async function mintPayLink(
  db: Db,
  orgId: string,
  invoiceId: string,
  env: AgentEnv,
): Promise<string> {
  const raw = crypto.getRandomValues(new Uint8Array(24));
  const token = btoa(String.fromCharCode(...raw))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const ins = await db.from('pay_tokens').insert({
    org_id: orgId,
    invoice_id: invoiceId,
    token_hash: await sha256Hex(token),
    expires_at: new Date((env.now ?? new Date()).getTime() + 60 * 86400_000).toISOString(),
  });
  if (ins.error) throw new Error(`pay token: ${ins.error.message}`);
  return `${env.appBaseUrl}/pay/${token}`;
}

async function resendSend(
  env: AgentEnv,
  a: { from: string; to: string; replyTo: string | null; subject: string; text: string },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!env.resendKey) return { ok: false, error: 'RESEND_API_KEY is not set' };
  try {
    const r = await (env.fetchImpl ?? fetch)('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.resendKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: a.from,
        to: [a.to],
        subject: a.subject,
        text: a.text,
        ...(a.replyTo ? { reply_to: a.replyTo } : {}),
      }),
    });
    const j = (await r.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!r.ok || !j.id)
      return { ok: false, error: `Resend ${r.status}: ${j.message ?? 'no id'}`.slice(0, 300) };
    return { ok: true, id: j.id };
  } catch (e) {
    return { ok: false, error: `Resend unreachable: ${(e as Error).message}`.slice(0, 300) };
  }
}

async function whatsappCloudSend(
  env: AgentEnv,
  to: string,
  text: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!env.whatsappToken || !env.whatsappPhoneId)
    return { ok: false, error: 'WhatsApp Cloud API not configured' };
  const digits = to.replace(/\D/g, '');
  const full = digits.length === 10 ? `91${digits}` : digits;
  try {
    const r = await (env.fetchImpl ?? fetch)(
      `https://graph.facebook.com/v21.0/${env.whatsappPhoneId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.whatsappToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: full,
          type: 'text',
          text: { body: text },
        }),
      },
    );
    const j = (await r.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { message?: string };
    };
    const id = j.messages?.[0]?.id;
    if (!r.ok || !id)
      return {
        ok: false,
        error: `WhatsApp ${r.status}: ${j.error?.message ?? 'no id'}`.slice(0, 300),
      };
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: `WhatsApp unreachable: ${(e as Error).message}`.slice(0, 300) };
  }
}

export async function runSend(
  db: Db,
  orgId: string,
  env: AgentEnv,
  opts: { actionIds?: string[] } = {},
): Promise<SendResult> {
  const now = env.now ?? new Date();
  const nowIso = now.toISOString();
  const p = await loadProfile(db, orgId);
  const today = planDay(p, now);
  const out: SendResult = { sent: 0, failed: 0, deferred: 0, waitingWhatsapp: 0, skipped: 0 };
  let q = db
    .from('agent_actions')
    .select(
      'id, invoice_id, customer_id, stage, channel, subject, body_template, approver, attempts, decision_log, wa_url',
    )
    .eq('org_id', orgId)
    .eq('status', 'approved')
    .eq('action_type', 'send_reminder')
    .eq('run_date', today)
    .order('priority', { ascending: true });
  if (opts.actionIds?.length) q = q.in('id', opts.actionIds);
  const rows = must(await q, 'approved') as unknown as ActionRow[];
  if (rows.length === 0) return out;

  const { groups } = await loadToday(orgId, today, db);
  const byKey = new Map(groups.map((g) => [`${g.primary.invoice.id}|${g.primary.stage}`, g]));
  const messaged = new Set<string>();
  const owner = await ownerEmail(db, p);
  const quiet = !p.test_mode && inQuiet(now, p.quiet_start_hour, p.quiet_end_hour);

  const finish = async (
    r: ActionRow,
    patch: Record<string, unknown>,
    by: string,
    decision: string,
    note: string,
  ) =>
    db
      .from('agent_actions')
      .update({
        ...patch,
        decision_log: [...r.decision_log, { at: nowIso, by, decision, note }],
      })
      .eq('id', r.id);

  for (const r of rows) {
    const g = byKey.get(`${r.invoice_id}|${r.stage}`);
    if (!g || g.customer.id !== r.customer_id) {
      await finish(
        r,
        { status: 'skipped', draft_note: 'No longer due.' },
        'sender',
        'skipped',
        'No longer due (paid, paused or changed).',
      );
      out.skipped++;
      continue;
    }
    if (g.alreadyMessagedToday || messaged.has(r.customer_id)) {
      await finish(
        r,
        { status: 'skipped', draft_note: 'Customer already messaged today.' },
        'sender',
        'skipped',
        'One message per customer per day.',
      );
      out.skipped++;
      continue;
    }
    if (quiet) {
      out.deferred++;
      continue;
    }
    const sv = buildSlotValues(g.primary, g.customer, p as never, today);
    const link = await mintPayLink(db, orgId, r.invoice_id, env);
    const values = { ...sv.values, pay_link: link };
    const fallback = templateDraft(r.stage as MessageStage, g.customer.language);
    let subject: string;
    let body: string;
    try {
      subject = renderTemplate(r.subject ?? fallback.subject, values);
      body = renderTemplate(r.body_template ?? fallback.body, values);
    } catch {
      subject = renderTemplate(fallback.subject, values);
      body = renderTemplate(fallback.body, values);
    }

    if (r.channel === 'whatsapp') {
      if (env.whatsappToken && env.whatsappPhoneId && g.customer.phone && !p.test_mode) {
        const w = await whatsappCloudSend(env, g.customer.phone, body);
        if (w.ok) {
          await db.rpc('record_send', {
            p_org: orgId,
            p_invoice: r.invoice_id,
            p_stage: r.stage,
            p_channel: 'whatsapp',
            p_body: body,
          });
          await finish(
            r,
            { status: 'sent', executed_at: nowIso, error: null },
            r.approver ?? 'system',
            'sent',
            `WhatsApp ${w.id}`,
          );
          messaged.add(r.customer_id);
          out.sent++;
        } else {
          await finish(
            r,
            { status: 'failed', error: w.error, attempts: r.attempts + 1 },
            'sender',
            'failed',
            w.error,
          );
          out.failed++;
        }
      } else {
        // wa.me path: the owner taps the link in Today and confirms the send.
        const url = g.customer.phone ? whatsappUrl(g.customer.phone, body) : null;
        await db
          .from('agent_actions')
          .update({
            wa_url: url,
            body_template: r.body_template,
            draft_note: 'Waiting for you to open WhatsApp and send.',
          })
          .eq('id', r.id);
        out.waitingWhatsapp++;
      }
      continue;
    }

    // email
    const to = p.test_mode ? owner : g.customer.email;
    if (!to) {
      const err = p.test_mode
        ? 'No owner email to receive test messages.'
        : 'Customer has no email.';
      await finish(
        r,
        { status: 'failed', error: err, attempts: r.attempts + 1 },
        'sender',
        'failed',
        err,
      );
      out.failed++;
      continue;
    }
    const text = p.test_mode
      ? `TEST MODE: this message would have gone to ${g.customer.name} <${g.customer.email ?? 'no email'}>.\n\n${body}`
      : body;
    const res = await resendSend(env, {
      from: `${p.legal_name || 'Receivia'} via Receivia <${env.fromEmail ?? 'onboarding@resend.dev'}>`,
      to,
      replyTo: owner,
      subject: p.test_mode ? `[TEST] ${subject}` : subject,
      text,
    });
    if (!res.ok) {
      await finish(
        r,
        { status: 'failed', error: res.error, attempts: r.attempts + 1 },
        'sender',
        'failed',
        res.error,
      );
      out.failed++;
      continue;
    }
    let note = p.test_mode ? `Test send to ${to}` : `Email ${res.id}`;
    if (!p.test_mode) {
      const rec = await db.rpc('record_send', {
        p_org: orgId,
        p_invoice: r.invoice_id,
        p_stage: r.stage,
        p_channel: 'email',
        p_body: body,
      });
      if (rec.error) note += ` (sent, but logging failed: ${rec.error.message})`;
    }
    await finish(
      r,
      { status: 'sent', executed_at: nowIso, error: null, draft_note: note },
      r.approver ?? 'system',
      'sent',
      `${note} [${res.id}]`,
    );
    messaged.add(r.customer_id);
    out.sent++;
  }
  return out;
}

// ---- Approve all -----------------------------------------------------------------------------

export async function approveAll(
  db: Db,
  orgId: string,
  day: string,
  by: string,
  env: AgentEnv,
): Promise<{ approved: number }> {
  const nowIso = (env.now ?? new Date()).toISOString();
  const rows = must(
    await db
      .from('agent_actions')
      .select('id, decision_log')
      .eq('org_id', orgId)
      .eq('run_date', day)
      .eq('status', 'proposed')
      .eq('action_type', 'send_reminder'),
    'proposed',
  ) as { id: string; decision_log: unknown[] }[];
  for (const r of rows) {
    await db
      .from('agent_actions')
      .update({
        status: 'approved',
        approver: by,
        decided_at: nowIso,
        decision_log: [
          ...r.decision_log,
          { at: nowIso, by, decision: 'approved', note: 'Approve all from the daily brief.' },
        ],
      })
      .eq('id', r.id);
  }
  return { approved: rows.length };
}

export { signApproval, verifyApproval };

// ---- Brief -----------------------------------------------------------------------------------

export interface BriefResult {
  sent: boolean;
  to: string | null;
  error?: string;
  subject?: string;
}

export async function runBrief(db: Db, orgId: string, env: AgentEnv): Promise<BriefResult> {
  const now = env.now ?? new Date();
  const p = await loadProfile(db, orgId);
  const today = planDay(p, now);
  const to = await ownerEmail(db, p);
  if (!to) return { sent: false, to: null, error: 'No owner email' };
  const acts = must(
    await db
      .from('agent_actions')
      .select('status, approver, payload, action_type')
      .eq('org_id', orgId)
      .eq('run_date', today)
      .eq('action_type', 'send_reminder')
      .neq('status', 'skipped')
      .neq('status', 'rejected'),
    'actions',
  ) as { status: string; approver: string | null; payload: { amount_due_paise?: number } }[];
  const proposed = acts.filter((a) => a.status === 'proposed').length;
  const exp = Math.floor(now.getTime() / 1000) + APPROVAL_TTL_SECONDS;
  const token =
    proposed > 0 ? await signApproval({ org: orgId, day: today, exp }, env.signingSecret) : null;
  const { shortfallWeek } = await chaseFor(db, orgId, today);
  const brief = buildBrief(
    {
      business: p.legal_name || 'Your business',
      toChase: acts.length,
      needApproval: proposed,
      autoSent: acts.filter((a) => a.status === 'sent' && a.approver?.startsWith('auto:')).length,
      failed: acts.filter((a) => a.status === 'failed').length,
      amountPaise: acts.reduce((s, a) => s + (a.payload?.amount_due_paise ?? 0), 0),
      shortfallWeek,
      approveUrl: token ? `${env.appBaseUrl}/approve?t=${encodeURIComponent(token)}` : null,
      openUrl: `${env.appBaseUrl}/collect`,
      testMode: p.test_mode,
    },
    p.owner_language ?? 'en',
  );
  const res = await resendSend(env, {
    from: `Receivia <${env.fromEmail ?? 'onboarding@resend.dev'}>`,
    to,
    replyTo: null,
    subject: brief.subject,
    text: brief.text,
  });
  return res.ok
    ? { sent: true, to, subject: brief.subject }
    : { sent: false, to, error: res.error };
}

// ---- Whole run with per-step retries and a run log ---------------------------------------------

export type RunTrigger = 'manual' | 'render' | 'pg_cron' | 'local' | 'approve_link';
export interface StepLog {
  step: string;
  ok: boolean;
  attempts: number;
  result?: unknown;
  error?: string;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  waitMs = 500,
): Promise<
  { ok: true; value: T; attempts: number } | { ok: false; error: string; attempts: number }
> {
  let last = '';
  for (let i = 1; i <= attempts; i++) {
    try {
      return { ok: true, value: await fn(), attempts: i };
    } catch (e) {
      last = (e as Error).message;
      if (i < attempts) await new Promise((r) => setTimeout(r, waitMs * 2 ** (i - 1)));
    }
  }
  return { ok: false, error: last, attempts };
}

export async function runAll(
  db: Db,
  orgId: string,
  env: AgentEnv,
  trigger: RunTrigger,
  opts: { skipBrief?: boolean } = {},
): Promise<{ status: string; steps: StepLog[] }> {
  const now = env.now ?? new Date();
  const p = await loadProfile(db, orgId);
  const day = planDay(p, now);
  const run = must(
    await db
      .from('agent_runs')
      .insert({ org_id: orgId, run_date: day, trigger })
      .select('id')
      .single(),
    'run log',
  ) as { id: string };
  const steps: StepLog[] = [];
  const step = async (name: string, fn: () => Promise<unknown>) => {
    const r = await withRetry(fn);
    steps.push(
      r.ok
        ? { step: name, ok: true, attempts: r.attempts, result: r.value }
        : { step: name, ok: false, attempts: r.attempts, error: r.error },
    );
  };
  await step('plan', () => runPlan(db, orgId, env));
  await step('send', () => runSend(db, orgId, env));
  if (!opts.skipBrief) await step('brief', () => runBrief(db, orgId, env));
  const bad = steps.filter((s) => !s.ok).length;
  const status = bad === 0 ? 'ok' : bad === steps.length ? 'failed' : 'partial';
  await db
    .from('agent_runs')
    .update({ status, steps, finished_at: new Date().toISOString() })
    .eq('id', run.id);
  return { status, steps };
}

export { askBooks, classifyReply, loadBooks, loadOpenInvoices } from '@/features/ai/server';
