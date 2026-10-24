import { addDays, daysBetween, type ISODate } from '@/lib/dates';

export const STAGES = [
  'pre_due',
  'due_today',
  'overdue_firm',
  'final',
  'demand_letter',
  'next_steps',
] as const;
export type Stage = (typeof STAGES)[number];

/** Days from the due date at which each stage becomes due. Editable per business in Settings. */
export type LadderConfig = Record<Stage, number>;

export const DEFAULT_LADDER: LadderConfig = {
  pre_due: -3,
  due_today: 0,
  overdue_firm: 7,
  final: 15,
  demand_letter: 30,
  next_steps: 45,
};

export const STAGE_LABEL: Record<Stage, string> = {
  pre_due: 'Friendly reminder',
  due_today: 'Due today',
  overdue_firm: 'Firm reminder',
  final: 'Final reminder and call',
  demand_letter: 'Payment Demand Letter',
  next_steps: 'Next steps',
};

/** Stages after this one need the owner's approval for key-tier customers. */
export const KEY_TIER_LIMIT: Stage = 'overdue_firm';

const idx = (s: Stage) => STAGES.indexOf(s);
const at = (i: number): Stage => STAGES[i] as Stage;

/** Returns an error message, or null when the config is usable (strictly increasing days). */
export function validateLadder(c: LadderConfig): string | null {
  for (const s of STAGES) {
    if (!Number.isInteger(c[s]) || c[s] < -30 || c[s] > 365)
      return `Days for "${STAGE_LABEL[s]}" must be a whole number between -30 and 365.`;
  }
  for (let i = 1; i < STAGES.length; i++) {
    if (c[at(i)] <= c[at(i - 1)])
      return `"${STAGE_LABEL[at(i)]}" must come after "${STAGE_LABEL[at(i - 1)]}".`;
  }
  return null;
}

export interface LadderInvoice {
  due_date: ISODate;
  total_paise: number;
  paid_paise: number;
  credited_paise?: number;
  tds_paise?: number;
  status: 'draft' | 'issued' | 'partially_paid' | 'paid' | 'void';
}

export interface LadderInput {
  invoice: LadderInvoice;
  tier: 'key' | 'standard';
  today: ISODate;
  config?: LadderConfig;
  /** Stages already sent or marked sent for this invoice, on any channel. */
  sentStages: readonly Stage[];
  hasOpenDispute: boolean;
  /** The buyer says they already paid and the owner has not yet confirmed or rejected it. */
  hasPendingClaim?: boolean;
  /** Open promise date, if any. */
  promisedFor?: ISODate | null;
  /** Stages the owner has approved for a key-tier customer. */
  approvedStages?: readonly Stage[];
}

export type LadderDecision =
  | { action: 'none'; reason: string }
  | { action: 'paused'; reason: string; until?: ISODate }
  | {
      action: 'needs_approval';
      stage: Stage;
      reason: string;
      daysOverdue: number;
      amountDue: number;
    }
  | {
      action: 'send';
      stage: Stage;
      reason: string;
      daysOverdue: number;
      amountDue: number;
      callPrompt: boolean;
    };

export function amountDue(i: LadderInvoice): number {
  return Math.max(i.total_paise - i.paid_paise - (i.credited_paise ?? 0) - (i.tds_paise ?? 0), 0);
}

/**
 * Decides the one stage (if any) that is due for an invoice today. Pure.
 * - Never repeats a stage and never goes back: only stages after the highest sent one qualify.
 * - If several are due (catch-up after a pause), only the latest due stage is used.
 * - Part payment changes the amount, not the stage.
 */
export function nextAction(input: LadderInput): LadderDecision {
  const { invoice, today } = input;
  const cfg = input.config ?? DEFAULT_LADDER;
  const due = amountDue(invoice);
  if (invoice.status === 'draft' || invoice.status === 'void')
    return { action: 'none', reason: 'Invoice is not live.' };
  if (due <= 0 || invoice.status === 'paid') return { action: 'none', reason: 'Nothing is owed.' };
  if (input.hasOpenDispute)
    return { action: 'paused', reason: 'Open dispute: reminders are paused until it is resolved.' };
  if (input.hasPendingClaim) {
    return {
      action: 'paused',
      reason: 'Buyer says they have paid: confirm or reject it in the Inbox.',
    };
  }
  if (input.promisedFor && input.promisedFor >= today) {
    return {
      action: 'paused',
      reason: `Customer promised to pay on ${input.promisedFor}.`,
      until: addDays(input.promisedFor, 1),
    };
  }
  const days = daysBetween(invoice.due_date, today);
  const highestSent = Math.max(-1, ...input.sentStages.map(idx));
  let pick = -1;
  for (let i = STAGES.length - 1; i > highestSent; i--) {
    if (days >= cfg[at(i)]) {
      pick = i;
      break;
    }
  }
  if (pick < 0) return { action: 'none', reason: 'No stage is due yet.' };
  const stage = at(pick);
  const base = { stage, daysOverdue: Math.max(days, 0), amountDue: due };
  if (
    input.tier === 'key' &&
    pick > idx(KEY_TIER_LIMIT) &&
    !(input.approvedStages ?? []).includes(stage)
  ) {
    return {
      action: 'needs_approval',
      reason: `Key customer: "${STAGE_LABEL[stage]}" needs your approval.`,
      ...base,
    };
  }
  return { action: 'send', reason: STAGE_LABEL[stage], ...base, callPrompt: stage === 'final' };
}

/** Steps shown for the last stage; Samadhaan only for eligible suppliers. */
export function nextStepsGuide(msmeEligible: boolean, government = false): string[] {
  const steps = [
    'Call the buyer and note what they say.',
    'Consider consulting a lawyer or your CA about options for recovery.',
  ];
  if (msmeEligible) {
    steps.push(
      'You may be able to file a reference on the MSME Samadhaan portal (samadhaan.msme.gov.in); open the case pack for what it asks for.',
    );
  }
  if (government) {
    steps.push(
      'Government/PSU buyer: write to the department’s nodal officer for payments, then (if eligible) MSME Samadhaan, then CPGRAMS (pgportal.gov.in). The case pack has a checklist for each.',
    );
  }
  return steps;
}

export const CALL_PROMPT =
  'Call the buyer today. Ask: have they received the invoice, is there any problem with it, and on what date will they pay? Note the answer, then record a promise to pay or a dispute.';
