import { formatINR, paise, type Paise } from '@/lib/money';
import type { BankLine } from './bankCsv';
import { explainShortfall, type EntityKind, type TdsCandidate } from './tds';

export interface OpenInvoice {
  id: string;
  number: string;
  customerId: string;
  balancePaise: number;
  taxablePaise: number;
  issueDate: string;
  dueDate: string;
}

export interface MatchCustomer {
  id: string;
  name: string;
  entityType: EntityKind;
}

export type MatchKind = 'exact' | 'multi' | 'part' | 'tds_short' | 'overpayment' | 'unknown' | 'debit';

export interface Allocation {
  invoiceId: string;
  invoiceNumber: string;
  amountPaise: Paise;
}

export interface Suggestion {
  line: BankLine;
  kind: MatchKind;
  /** 0 to 1. */
  confidence: number;
  customerId: string | null;
  allocations: Allocation[];
  tds: TdsCandidate | null;
  tdsInvoiceId: string | null;
  creditBalancePaise: Paise;
  reason: string;
}

/** Letters and digits only, upper case: "inv 26-27 / 0001" and "INV/26-27/0001" both become INV26270001. */
export function alnum(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const NOISE = new Set(['M', 'MS', 'PVT', 'PRIVATE', 'LTD', 'LIMITED', 'LLP', 'CO', 'COMPANY', 'AND', 'THE', 'OF', 'INC']);

/** Significant words of a name: M/s, Pvt, Ltd, LLP and punctuation dropped, upper case. */
export function nameTokens(name: string): string[] {
  return name
    .toUpperCase()
    .replace(/M\/S\.?/g, ' ')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !NOISE.has(t));
}

/** Customers whose significant words all appear in the text; longest name wins. */
export function matchCustomer(text: string, customers: MatchCustomer[]): MatchCustomer | null {
  const hay = ` ${text.toUpperCase().replace(/[^A-Z0-9]/g, ' ').replace(/\s+/g, ' ')} `;
  const compact = alnum(text);
  let best: { c: MatchCustomer; score: number } | null = null;
  for (const c of customers) {
    const toks = nameTokens(c.name);
    if (!toks.length) continue;
    const all = toks.every((t) => hay.includes(` ${t} `) || compact.includes(t));
    // Bank narrations often truncate the name: accept the first two words when the name has 3 or more.
    const prefix = toks.length >= 3 && toks.slice(0, 2).every((t) => compact.includes(t));
    if (all || prefix) {
      const score = toks.join('').length + (all ? 100 : 0);
      if (!best || score > best.score) best = { c, score };
    }
  }
  return best?.c ?? null;
}

/** Invoices whose number appears in the text, in order of appearance, with any spacing or separator. */
export function namedInvoices(text: string, invoices: OpenInvoice[]): OpenInvoice[] {
  const compact = alnum(text);
  const found: { inv: OpenInvoice; at: number }[] = [];
  for (const inv of invoices) {
    const key = alnum(inv.number);
    if (key.length < 4) continue;
    let from = 0;
    for (;;) {
      const at = compact.indexOf(key, from);
      if (at < 0) break;
      const next = compact[at + key.length];
      const prev = compact[at - 1];
      // A longer number (…00012 vs …0001) or a glued-on prefix is a different invoice.
      if (!(next && /[0-9]/.test(next)) && !(prev && /[0-9]/.test(prev) && /[0-9]/.test(key[0]!))) {
        found.push({ inv, at });
        break;
      }
      from = at + 1;
    }
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.inv);
}

const byAge = (a: OpenInvoice, b: OpenInvoice) =>
  a.dueDate.localeCompare(b.dueDate) || a.issueDate.localeCompare(b.issueDate) || a.number.localeCompare(b.number);

function allocate(amount: number, invs: OpenInvoice[]): { allocations: Allocation[]; left: number } {
  let left = amount;
  const allocations: Allocation[] = [];
  for (const inv of invs) {
    if (left <= 0) break;
    const take = Math.min(left, inv.balancePaise);
    if (take > 0) allocations.push({ invoiceId: inv.id, invoiceNumber: inv.number, amountPaise: paise(take) });
    left -= take;
  }
  return { allocations, left };
}

const conf = (x: number) => Math.round(Math.min(0.99, Math.max(0.05, x)) * 100) / 100;

export function suggestOne(
  line: BankLine,
  invoices: OpenInvoice[],
  customers: MatchCustomer[],
): Suggestion {
  const base = {
    line,
    customerId: null as string | null,
    allocations: [] as Allocation[],
    tds: null as TdsCandidate | null,
    tdsInvoiceId: null as string | null,
    creditBalancePaise: paise(0),
  };
  if (line.creditPaise <= 0) {
    return { ...base, kind: 'debit', confidence: 1, reason: 'This is a debit (money out), so it is not matched to an invoice.' };
  }
  const amount = line.creditPaise;
  const text = `${line.description} ${line.reference}`;
  const named = namedInvoices(text, invoices);
  const cust = matchCustomer(line.description, customers);
  const customerId = named[0]?.customerId ?? cust?.id ?? null;
  const entity = customers.find((c) => c.id === customerId)?.entityType ?? null;
  const nameOk = Boolean(cust) && (!named.length || named[0]!.customerId === cust!.id);

  let candidates: OpenInvoice[] = [];
  let how: 'named' | 'customer' | 'amount' = 'customer';
  if (named.length) {
    candidates = named;
    how = 'named';
  } else if (customerId) {
    const mine = invoices.filter((i) => i.customerId === customerId && i.balancePaise > 0).sort(byAge);
    const one = mine.find((i) => i.balancePaise === amount);
    candidates = one ? [one] : mine;
    how = 'customer';
  } else {
    const same = invoices.filter((i) => i.balancePaise === amount);
    if (same.length === 1) {
      candidates = same;
      how = 'amount';
    }
  }
  if (!candidates.length) {
    return {
      ...base,
      customerId,
      kind: 'unknown',
      confidence: 0.1,
      reason: customerId
        ? 'The customer looks right but no open invoice is left to apply this deposit to. Treat it as an advance or unknown deposit.'
        : 'No invoice number, customer name or amount in this line matches anything open. Treat it as an unknown deposit.',
    };
  }

  const total = candidates.reduce((s, i) => s + i.balancePaise, 0);
  const evidence =
    (how === 'named' ? 0.55 : how === 'amount' ? 0.35 : 0) + (nameOk || (how === 'customer' && cust) ? 0.25 : 0);
  const who = (n: number) => (n === 1 ? `Invoice ${candidates[0]!.number}` : `${n} invoices`);
  const found =
    how === 'named'
      ? `${who(candidates.length)} named in the description`
      : how === 'amount'
        ? 'No invoice number or name, but the amount equals exactly one open invoice'
        : `Customer name matches ${cust?.name}`;
  const withCust = { ...base, customerId };

  // Exact: pays everything in the candidate set.
  if (amount === total) {
    const a = allocate(amount, candidates);
    const multi = candidates.length > 1;
    return {
      ...withCust,
      allocations: a.allocations,
      kind: multi ? 'multi' : 'exact',
      confidence: conf(evidence + 0.2),
      reason: `${found}, and the amount ${formatINR(paise(amount))} equals ${multi ? `their combined balance (${candidates.map((c) => c.number).join(' + ')})` : 'its balance exactly'}.${
        multi && how === 'customer' ? ' Applied oldest first because no invoice was named.' : ''
      }`,
    };
  }

  // Short: could be TDS or TCS.
  if (amount < total) {
    const taxable = candidates.reduce((s, i) => s + i.taxablePaise, 0);
    const tds = explainShortfall({ shortfallPaise: total - amount, taxablePaise: taxable, entity });
    if (tds) {
      const a = allocate(amount, candidates);
      return {
        ...withCust,
        allocations: a.allocations,
        tds,
        tdsInvoiceId: candidates[candidates.length - 1]!.id,
        kind: 'tds_short',
        confidence: conf(evidence + 0.1),
        reason: `${found}. The payment is ${formatINR(tds.amountPaise)} short, which is ${tds.ratePct}% of the taxable value ${formatINR(tds.taxablePaise)}: likely ${tds.label}${
          tds.alsoPossible.length ? ` (could also be ${tds.alsoPossible.join(' or ')})` : ''
        }. Verify the rate. Confirm to record the TDS and close the invoice once the certificate arrives.`,
      };
    }
    const a = allocate(amount, candidates);
    const multi = candidates.length > 1;
    return {
      ...withCust,
      allocations: a.allocations,
      kind: multi ? 'multi' : 'part',
      confidence: conf(evidence + 0.05),
      reason: `${found}. The amount ${formatINR(paise(amount))} is less than ${multi ? 'the combined balance' : 'the balance'} ${formatINR(paise(total))}, so it is treated as a part payment${
        multi ? ` applied ${how === 'named' ? 'in the order named' : 'oldest first'}` : ''
      }; ${formatINR(paise(total - amount))} stays due.`,
    };
  }

  // Over: pays everything and some more.
  const a = allocate(amount, candidates);
  return {
    ...withCust,
    allocations: a.allocations,
    kind: 'overpayment',
    creditBalancePaise: paise(a.left),
    confidence: conf(evidence + 0.1),
    reason: `${found}. The amount ${formatINR(paise(amount))} is ${formatINR(paise(a.left))} more than the balance ${formatINR(paise(total))}; the extra is kept as a credit balance for the customer, not applied to any invoice.`,
  };
}

/**
 * Suggestions for every line. Invoice balances are consumed as lines are matched so two deposits
 * cannot both claim the same balance. Nothing is final until the owner confirms.
 */
export function suggestMatches(
  lines: BankLine[],
  invoices: OpenInvoice[],
  customers: MatchCustomer[],
): Suggestion[] {
  const left = new Map(invoices.map((i) => [i.id, i.balancePaise]));
  return lines.map((line) => {
    const open = invoices.map((i) => ({ ...i, balancePaise: left.get(i.id) ?? 0 })).filter((i) => i.balancePaise > 0);
    const s = suggestOne(line, open, customers);
    for (const a of s.allocations) left.set(a.invoiceId, (left.get(a.invoiceId) ?? 0) - a.amountPaise);
    if (s.tds && s.tdsInvoiceId) left.set(s.tdsInvoiceId, Math.max(0, (left.get(s.tdsInvoiceId) ?? 0) - s.tds.amountPaise));
    return s;
  });
}
