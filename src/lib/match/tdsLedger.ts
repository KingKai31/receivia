import { formatINR, paise } from '@/lib/money';
import { parseCsv } from './bankCsv';
import { matchCustomer } from './match';
import { tdsQuarter } from './tds';

export interface TdsRow {
  id: string;
  customerId: string;
  customerName: string;
  section: string;
  amountPaise: number;
  deductedOn: string;
  certificateStatus: 'pending' | 'requested' | 'received' | 'not_applicable';
  claimedIn26as: boolean;
}

export interface TdsSummaryLine {
  customerId: string;
  customerName: string;
  quarter: string;
  deductedPaise: number;
  /** Certificate received from the buyer. */
  receivedPaise: number;
  /** Seen in Form 26AS / AIS, so the credit can be claimed. */
  claimedPaise: number;
  entryIds: string[];
  /** Entries still waiting for a certificate (pending or requested). */
  openIds: string[];
}

/** Deducted vs received vs claimed, per customer per Indian FY quarter. */
export function summarizeTds(rows: TdsRow[]): TdsSummaryLine[] {
  const map = new Map<string, TdsSummaryLine>();
  for (const r of rows) {
    if (r.certificateStatus === 'not_applicable') continue;
    const quarter = tdsQuarter(r.deductedOn);
    const key = `${r.customerId}|${quarter}`;
    const line = map.get(key) ?? {
      customerId: r.customerId,
      customerName: r.customerName,
      quarter,
      deductedPaise: 0,
      receivedPaise: 0,
      claimedPaise: 0,
      entryIds: [],
      openIds: [],
    };
    line.deductedPaise += r.amountPaise;
    if (r.certificateStatus === 'received') line.receivedPaise += r.amountPaise;
    else line.openIds.push(r.id);
    if (r.claimedIn26as) line.claimedPaise += r.amountPaise;
    line.entryIds.push(r.id);
    map.set(key, line);
  }
  return [...map.values()].sort(
    (a, b) => b.quarter.localeCompare(a.quarter) || a.customerName.localeCompare(b.customerName),
  );
}

export function certificateRequestText(args: {
  customer: string;
  quarter: string;
  amountPaise: number;
  business: string;
  contact: string;
}): string {
  return `Hello ${args.customer}, you deducted TDS of ${formatINR(paise(args.amountPaise))} from our invoices for ${args.quarter}. Could you please share the TDS certificate (Form 16A) and confirm it is filed so it shows in our Form 26AS? Thank you. ${args.business}${args.contact ? ` ${args.contact}` : ''}`.trim();
}

export interface Row26as {
  deductor: string;
  section: string;
  amountPaise: number;
  date: string | null;
}

const find = (headers: string[], re: RegExp) => headers.find((h) => re.test(h.trim()));

/** Reads a Form 26AS / AIS CSV export: deductor name, section, tax deducted, date (best effort by header). */
export function parse26as(text: string): { rows: Row26as[]; errors: string[] } {
  const grid = parseCsv(text);
  const headers = grid[0] ?? [];
  const name = find(headers, /deductor|name/i);
  const section = find(headers, /section/i);
  const amount =
    find(headers, /tax\s*deducted|amount\s*deducted|tax\s*deposited/i) ??
    find(headers, /tds/i) ??
    find(headers, /amount/i);
  const date = find(headers, /date|booking/i);
  if (!amount || !name)
    return { rows: [], errors: ['Need a deductor name column and a tax deducted amount column.'] };
  const ix = (h?: string) => (h ? headers.indexOf(h) : -1);
  const errors: string[] = [];
  const rows: Row26as[] = [];
  grid.slice(1).forEach((r, i) => {
    const raw = (r[ix(amount)] ?? '').replace(/[₹,\s]/g, '');
    const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
    if (!m) return void errors.push(`Row ${i + 2}: unreadable amount.`);
    rows.push({
      deductor: (r[ix(name)] ?? '').trim(),
      section: ((r[ix(section)] ?? '').match(/\d{3}[A-Z]?/)?.[0] ?? '').toUpperCase(),
      amountPaise: Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0),
      date: (r[ix(date)] ?? '').trim() || null,
    });
  });
  return { rows, errors };
}

/**
 * Ticks entries that appear in 26AS: same amount (+/- Rs 1), same section when both state one, and
 * the deductor name loosely matches the customer. Each entry is used once.
 */
export function match26as(
  rows: Row26as[],
  entries: TdsRow[],
): { matched: { entryId: string; row: Row26as }[]; unmatched: Row26as[] } {
  const used = new Set<string>();
  const matched: { entryId: string; row: Row26as }[] = [];
  const unmatched: Row26as[] = [];
  const customers = [
    ...new Map(
      entries.map((e) => [
        e.customerId,
        { id: e.customerId, name: e.customerName, entityType: null },
      ]),
    ).values(),
  ];
  for (const row of rows) {
    const cust = matchCustomer(row.deductor, customers);
    const hit = entries.find(
      (e) =>
        !used.has(e.id) &&
        !e.claimedIn26as &&
        Math.abs(e.amountPaise - row.amountPaise) <= 100 &&
        (!row.section ||
          e.section.replace('GST_', '') === row.section ||
          e.section === row.section) &&
        cust?.id === e.customerId,
    );
    if (hit) {
      used.add(hit.id);
      matched.push({ entryId: hit.id, row });
    } else unmatched.push(row);
  }
  return { matched, unmatched };
}
