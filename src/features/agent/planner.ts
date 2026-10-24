import type { ISODate } from '@/lib/dates';
import { STAGES, STAGE_LABEL, type Stage } from '@/features/collect/ladder';
import { isGovernmentPath } from '@/lib/legal/government';
import { buildSlotValues, type TodayCustomer, type TodayGroup } from '@/features/collect/today';
import type { SlotValues } from '@/features/collect/templates';

export type Channel = 'email' | 'whatsapp';
export type Autonomy = 0 | 1 | 2;

export interface AgentSettings {
  autonomy: Autonomy;
  channels: Channel[];
  quietStart: number;
  quietEnd: number;
  testMode: boolean;
}

export const DEFAULT_SETTINGS: AgentSettings = {
  autonomy: 0,
  channels: ['email', 'whatsapp'],
  quietStart: 21,
  quietEnd: 9,
  testMode: true,
};

export const AUTONOMY_LABEL: Record<Autonomy, string> = {
  0: 'L0: suggest only',
  1: 'L1: auto-send friendly and reminder messages to standard customers',
  2: 'L2: auto-send up to the final reminder to standard customers',
};

/** Stages that can ever go out without the owner, by level. Demand letters never. */
const AUTO_STAGES: Record<Autonomy, Stage[]> = {
  0: [],
  1: ['pre_due', 'due_today', 'overdue_firm'],
  2: ['pre_due', 'due_today', 'overdue_firm', 'final'],
};

export interface AutoDecision {
  allowed: boolean;
  reason: string;
}

export function autoDecision(a: {
  autonomy: Autonomy;
  tier: 'key' | 'standard';
  stage: Stage;
}): AutoDecision {
  if (a.stage === 'demand_letter' || a.stage === 'next_steps')
    return { allowed: false, reason: `${STAGE_LABEL[a.stage]} always needs the owner.` };
  if (a.tier === 'key') return { allowed: false, reason: 'Key customers always need the owner.' };
  if (a.autonomy === 0) return { allowed: false, reason: 'Autonomy is L0 (suggest only).' };
  if (!AUTO_STAGES[a.autonomy].includes(a.stage))
    return {
      allowed: false,
      reason: `L${a.autonomy} does not auto-send "${STAGE_LABEL[a.stage]}".`,
    };
  return {
    allowed: true,
    reason: `Allowed automatically at L${a.autonomy} for a standard customer.`,
  };
}

export function pickChannel(
  c: Pick<TodayCustomer, 'email' | 'phone' | 'consent_withdrawn'> &
    Partial<Pick<TodayCustomer, 'entity_type' | 'is_psu'>> & { opt_in_whatsapp?: boolean },
  channels: readonly Channel[],
): { channel: Channel | null; note: string } {
  const out = c.consent_withdrawn ?? [];
  if (isGovernmentPath(c)) {
    if (out.includes('any') || out.includes('email'))
      return { channel: null, note: 'The customer has withdrawn consent to be contacted.' };
    return c.email && channels.includes('email')
      ? { channel: 'email', note: 'Government buyer: formal email only.' }
      : { channel: null, note: 'Government buyer: needs an email address (no WhatsApp).' };
  }
  if (out.includes('any'))
    return { channel: null, note: 'The customer has withdrawn consent to be contacted.' };
  const emailOk = channels.includes('email') && c.email && !out.includes('email');
  if (emailOk) return { channel: 'email', note: 'Email on file.' };
  const waEnabled = channels.includes('whatsapp') && c.phone;
  if (waEnabled && out.includes('whatsapp'))
    return { channel: null, note: 'The customer has withdrawn consent for WhatsApp.' };
  if (waEnabled && c.opt_in_whatsapp) return { channel: 'whatsapp', note: 'WhatsApp opted in.' };
  if (waEnabled && !c.opt_in_whatsapp)
    return { channel: null, note: 'Customer has not opted in to WhatsApp and has no email.' };
  if (channels.includes('email') && c.email && out.includes('email'))
    return { channel: null, note: 'The customer has withdrawn consent for email.' };
  return { channel: null, note: 'No enabled channel with contact details.' };
}

/** True when the IST hour falls in the quiet window (handles a window that wraps midnight). */
export function inQuiet(now: Date, start: number, end: number): boolean {
  const h = new Date(now.getTime() + 5.5 * 3600_000).getUTCHours();
  return start > end ? h >= start || h < end : h >= start && h < end;
}

export interface PlannedAction {
  action_type: 'send_reminder' | 'owner_task';
  customer_id: string;
  invoice_id: string;
  stage: Stage;
  channel: Channel | null;
  status: 'proposed' | 'approved' | 'skipped';
  priority: number;
  reasoning: string;
  policy_checks: { rule: string; pass: boolean; note: string }[];
  approver: string | null;
  decision_log: { at: string; by: string; decision: string; note: string }[];
  payload: Record<string, unknown>;
  slotValues: SlotValues | null;
  lensAllowed: boolean;
}

export interface PlanInput {
  groups: TodayGroup[]; // already ordered by chase priority
  settings: AgentSettings;
  today: ISODate;
  seller: Parameters<typeof buildSlotValues>[2];
  existing: ReadonlySet<string>; // `${invoice_id}|${stage}|${action_type}` already planned today
  promisesDueToday: {
    invoice_id: string;
    customer_id: string;
    customer: string;
    invoice_no: string;
  }[];
  nowIso: string;
}

export function existingKey(invoiceId: string, stage: string, type: string): string {
  return `${invoiceId}|${stage}|${type}`;
}

/** Pure planner: one action per customer per day from the ladder, in chase-priority order. */
export function planActions(input: PlanInput): PlannedAction[] {
  const out: PlannedAction[] = [];
  const { settings } = input;
  input.groups.forEach((g, rank) => {
    const p = g.primary;
    const c = g.customer;
    const key = existingKey(
      p.invoice.id,
      p.stage,
      p.stage === 'next_steps' ? 'owner_task' : 'send_reminder',
    );
    if (input.existing.has(key)) return;
    const base = {
      customer_id: c.id,
      invoice_id: p.invoice.id,
      stage: p.stage,
      priority: rank + 1,
      payload: {
        customer: c.name,
        invoice_no: p.invoice.number,
        amount_due_paise: p.decision.amountDue,
        days_overdue: p.decision.daysOverdue,
        tier: c.tier,
        language: c.language,
        other_invoices: g.items.length - 1,
      },
    };
    const label = `${STAGE_LABEL[p.stage]} for ${c.name}, ${p.invoice.number}, ${p.decision.daysOverdue} days overdue (priority ${rank + 1}).`;
    if (p.stage === 'next_steps') {
      out.push({
        ...base,
        action_type: 'owner_task',
        channel: null,
        status: 'proposed',
        reasoning: `${label} Owner guidance only; nothing is sent.`,
        policy_checks: [
          { rule: 'owner_only', pass: true, note: 'Next steps are never automated.' },
        ],
        approver: null,
        decision_log: [],
        slotValues: null,
        lensAllowed: false,
      });
      return;
    }
    const checks: PlannedAction['policy_checks'] = [
      { rule: 'ladder', pass: true, note: p.decision.reason },
    ];
    const ch = pickChannel(c as TodayCustomer & { opt_in_whatsapp?: boolean }, settings.channels);
    checks.push({ rule: 'channel_opt_in', pass: ch.channel !== null, note: ch.note });
    checks.push({
      rule: 'one_per_day',
      pass: !g.alreadyMessagedToday,
      note: g.alreadyMessagedToday
        ? 'Customer already has a message today.'
        : 'No message yet today.',
    });
    const auto = autoDecision({ autonomy: settings.autonomy, tier: c.tier, stage: p.stage });
    checks.push({ rule: 'autonomy', pass: auto.allowed, note: auto.reason });
    if (p.needsApproval)
      checks.push({ rule: 'key_tier_approval', pass: false, note: p.decision.reason });

    const sv = buildSlotValues(p, c, input.seller, input.today);
    let status: PlannedAction['status'] = 'proposed';
    let approver: string | null = null;
    const log: PlannedAction['decision_log'] = [];
    let reasoning = label;
    if (!ch.channel || g.alreadyMessagedToday) {
      status = 'skipped';
      reasoning += ` Skipped: ${!ch.channel ? ch.note : 'customer already has a message today.'}`;
      log.push({ at: input.nowIso, by: 'planner', decision: 'skipped', note: reasoning });
    } else if (auto.allowed && !p.needsApproval) {
      status = 'approved';
      approver = `auto:L${settings.autonomy}`;
      reasoning += ` Auto-approved: ${auto.reason}`;
      log.push({ at: input.nowIso, by: approver, decision: 'approved', note: auto.reason });
    } else {
      reasoning += ` Needs your approval: ${auto.reason}`;
    }
    out.push({
      ...base,
      action_type: 'send_reminder',
      channel: ch.channel,
      status,
      reasoning,
      policy_checks: checks,
      approver,
      decision_log: log,
      slotValues: sv.values,
      lensAllowed: sv.values.lens_line !== '',
    });
  });
  for (const pr of input.promisesDueToday) {
    const key = existingKey(pr.invoice_id, 'promise_due', 'owner_task');
    if (input.existing.has(key)) continue;
    out.push({
      action_type: 'owner_task',
      customer_id: pr.customer_id,
      invoice_id: pr.invoice_id,
      stage: 'promise_due' as unknown as Stage,
      channel: null,
      status: 'proposed',
      priority: 0,
      reasoning: `${pr.customer} promised to pay ${pr.invoice_no} today. Check the bank and the Inbox tonight; reminders resume tomorrow if it is unpaid.`,
      policy_checks: [
        { rule: 'owner_only', pass: true, note: 'Promise follow-up is a task for you.' },
      ],
      approver: null,
      decision_log: [],
      payload: { customer: pr.customer, invoice_no: pr.invoice_no },
      slotValues: null,
      lensAllowed: false,
    });
  }
  return out;
}

export const STAGE_ORDER = STAGES;
