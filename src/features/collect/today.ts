import i18next from 'i18next';
import type { ISODate } from '@/lib/dates';
import { formatINR, paise } from '@/lib/money';
import { buyerLens, isGovernmentPath, msmeEligibility } from '@/lib/legal';
import type { BuyerFacts, InvoiceFacts, SellerFacts } from '@/lib/legal';
import {
  CALL_PROMPT,
  DEFAULT_LADDER,
  STAGES,
  nextAction,
  nextStepsGuide,
  type LadderConfig,
  type LadderDecision,
  type Stage,
} from './ladder';
import { buildMessage, type Lang, type MessageStage, type SlotValues } from './templates';

export const PAY_LINK_PLACEHOLDER = '[pay link]';

export interface TodayInvoice extends InvoiceFacts {
  id: string;
  customer_id: string;
  number: string;
  due_date: ISODate;
  status: 'draft' | 'issued' | 'partially_paid' | 'paid' | 'void';
  disputed: boolean;
  approved_stages: Stage[];
  updated_at: string;
  /** Government bill-tracking reference, shown to government buyers. */
  bill_ref?: string | null;
}

export interface TodayCustomer extends BuyerFacts {
  id: string;
  name: string;
  tier: 'key' | 'standard';
  language: Lang;
  phone: string | null;
  email: string | null;
  snoozed_until: ISODate | null;
  updated_at: string;
  /** Channels the customer has withdrawn consent for ('any' blocks all). */
  consent_withdrawn?: string[];
  /** Accounts-payable contact: reminders go here first. */
  ap_email?: string | null;
  ap_phone?: string | null;
  preferred_channel?: 'email' | 'whatsapp' | 'sms' | null;
  cc_owner?: boolean;
}

export interface TodayInput {
  today: ISODate;
  seller: SellerFacts & { legal_name: string; phone: string | null };
  config?: LadderConfig;
  invoices: TodayInvoice[];
  customers: TodayCustomer[];
  sent: { invoice_id: string; stage: Stage }[];
  promises: { invoice_id: string; promised_for: ISODate }[];
  /** Invoices with an unresolved "I have already paid" claim. */
  pendingClaims?: string[];
  /** Customers who already have an outbound message today (IST). */
  messagedToday: string[];
}

export interface TodayItem {
  invoice: TodayInvoice;
  stage: Stage;
  decision: Extract<LadderDecision, { action: 'send' | 'needs_approval' }>;
  needsApproval: boolean;
}

export interface TodayGroup {
  customer: TodayCustomer;
  items: TodayItem[];
  /** The one item that gets a message today. Others wait for a later day. */
  primary: TodayItem;
  message: string | null;
  lensLine: string;
  callPrompt: string | null;
  guide: string[] | null;
  alreadyMessagedToday: boolean;
}

const MONTHS: Record<Lang, string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  hi: [
    'जन॰',
    'फ़र॰',
    'मार्च',
    'अप्रैल',
    'मई',
    'जून',
    'जुल॰',
    'अग॰',
    'सित॰',
    'अक्टू॰',
    'नव॰',
    'दिस॰',
  ],
  mr: [
    'जाने',
    'फेब्रु',
    'मार्च',
    'एप्रिल',
    'मे',
    'जून',
    'जुलै',
    'ऑग',
    'सप्टें',
    'ऑक्टो',
    'नोव्हें',
    'डिसें',
  ],
};
/** "24 Oct 2026". `lang` is the reader's language (customer language for messages, UI language elsewhere). */
export function prettyDate(d: ISODate, lang: Lang = uiLang()): string {
  const [y, m, day] = d.split('-').map(Number);
  return `${day} ${MONTHS[lang][(m ?? 1) - 1]} ${y}`;
}
function uiLang(): Lang {
  const l = i18next.language;
  return l === 'hi' || l === 'mr' ? l : 'en';
}

export type SlotSeller = TodayInput['seller'];

/** Slot values for one item, computed from facts only (never from model output). */
export function buildSlotValues(
  primary: TodayItem,
  customer: TodayCustomer,
  seller: SlotSeller,
  today: ISODate,
): { values: SlotValues; lensLine: string } {
  const lens = buyerLens({ seller, buyer: customer, invoice: primary.invoice, today });
  const lang = customer.language;
  const lensLine = lang === 'hi' ? lens.line_hi : lang === 'mr' ? lens.line_mr : lens.line_en;
  const showLens =
    primary.stage === 'overdue_firm' ||
    primary.stage === 'final' ||
    primary.stage === 'demand_letter';
  const values: SlotValues = {
    customer: customer.name,
    invoice_no: primary.invoice.number,
    amount_due: formatINR(paise(primary.decision.amountDue)),
    due_date: prettyDate(primary.invoice.due_date, lang),
    days_overdue: String(primary.decision.daysOverdue),
    pay_link: PAY_LINK_PLACEHOLDER,
    lens_line: showLens ? lensLine : '',
    contact: [
      isGovernmentPath(customer) && primary.invoice.bill_ref
        ? `Bill reference: ${primary.invoice.bill_ref}`
        : null,
      seller.legal_name,
      seller.phone,
    ]
      .filter(Boolean)
      .join(' '),
  };
  return { values, lensLine };
}

export function buildToday(input: TodayInput): TodayGroup[] {
  const cfg = input.config ?? DEFAULT_LADDER;
  const custs = new Map(input.customers.map((c) => [c.id, c]));
  const byCustomer = new Map<string, TodayItem[]>();
  for (const inv of input.invoices) {
    const customer = custs.get(inv.customer_id);
    if (!customer) continue;
    if (customer.snoozed_until && customer.snoozed_until >= input.today) continue;
    const promise = input.promises
      .filter((p) => p.invoice_id === inv.id)
      .map((p) => p.promised_for)
      .sort()
      .at(-1);
    const d = nextAction({
      invoice: inv,
      tier: customer.tier,
      today: input.today,
      config: cfg,
      sentStages: input.sent.filter((s) => s.invoice_id === inv.id).map((s) => s.stage),
      hasOpenDispute: inv.disputed,
      hasPendingClaim: (input.pendingClaims ?? []).includes(inv.id),
      promisedFor: promise ?? null,
      approvedStages: inv.approved_stages,
    });
    if (d.action !== 'send' && d.action !== 'needs_approval') continue;
    const list = byCustomer.get(customer.id) ?? [];
    list.push({
      invoice: inv,
      stage: d.stage,
      decision: d,
      needsApproval: d.action === 'needs_approval',
    });
    byCustomer.set(customer.id, list);
  }
  const groups: TodayGroup[] = [];
  for (const [cid, items] of byCustomer) {
    const customer = custs.get(cid)!;
    items.sort(
      (a, b) =>
        STAGES.indexOf(b.stage) - STAGES.indexOf(a.stage) ||
        b.decision.amountDue - a.decision.amountDue ||
        a.invoice.due_date.localeCompare(b.invoice.due_date),
    );
    const primary = items[0]!;
    let message: string | null = null;
    let lensLine = '';
    if (!primary.needsApproval && primary.stage !== 'next_steps') {
      const sv = buildSlotValues(primary, customer, input.seller, input.today);
      lensLine = sv.lensLine;
      message = buildMessage(
        primary.stage as MessageStage,
        customer.language,
        sv.values,
        isGovernmentPath(customer),
      );
    }
    groups.push({
      customer,
      items,
      primary,
      message,
      lensLine,
      callPrompt: primary.stage === 'final' && !primary.needsApproval ? CALL_PROMPT : null,
      guide:
        primary.stage === 'next_steps' && !primary.needsApproval
          ? nextStepsGuide(msmeEligibility(input.seller).applies, isGovernmentPath(customer))
          : null,
      alreadyMessagedToday: input.messagedToday.includes(cid),
    });
  }
  return groups.sort((a, b) => a.customer.name.localeCompare(b.customer.name));
}
