import { XMLParser, XMLValidator } from 'fast-xml-parser';

/** Tags we read. Anything else inside a voucher or ledger is skipped and reported. */
const VOUCHER_KNOWN = new Set([
  'DATE',
  'VOUCHERTYPENAME',
  'VOUCHERNUMBER',
  'PARTYLEDGERNAME',
  'PARTYNAME',
  'PARTYGSTIN',
  'ISCANCELLED',
  'ALLLEDGERENTRIES.LIST',
  'LEDGERENTRIES.LIST',
]);
const ENTRY_KNOWN = new Set(['LEDGERNAME', 'AMOUNT', 'ISDEEMEDPOSITIVE']);
const LEDGER_KNOWN = new Set([
  'NAME',
  'PARENT',
  'PARTYGSTIN',
  'GSTIN',
  'LEDGERPHONE',
  'LEDGERMOBILE',
  'EMAIL',
  'ADDRESS.LIST',
  'BILLCREDITPERIOD',
  'LANGUAGENAME.LIST',
]);

export interface TallyCustomer {
  row: number;
  values: Record<string, string>;
}
export interface TallyInvoice {
  row: number;
  values: Record<string, string>;
}

export interface TallyResult {
  customers: TallyCustomer[];
  invoices: TallyInvoice[];
  /** tag name -> number of times it was skipped */
  skippedTags: Record<string, number>;
  /** vouchers/ledgers left out on purpose, with the reason */
  notes: string[];
}

const ARRAY_TAGS = new Set([
  'VOUCHER',
  'LEDGER',
  'ALLLEDGERENTRIES.LIST',
  'LEDGERENTRIES.LIST',
  'ADDRESS',
]);

type Node = Record<string, unknown>;

function text(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') {
    const o = v as Node;
    if ('#text' in o) return String(o['#text']).trim();
    return '';
  }
  return String(v).trim();
}

function collect(node: unknown, key: string, out: Node[]): void {
  if (Array.isArray(node)) {
    for (const n of node) collect(n, key, out);
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node as Node)) {
    if (k === key) {
      for (const item of Array.isArray(v) ? v : [v])
        if (item && typeof item === 'object') out.push(item as Node);
    } else collect(v, key, out);
  }
}

function skipUnknown(node: Node, known: Set<string>, skipped: Record<string, number>) {
  for (const k of Object.keys(node)) {
    if (k.startsWith('@_') || k === '#text' || known.has(k)) continue;
    skipped[k] = (skipped[k] ?? 0) + 1;
  }
}

function ledgerName(l: Node): string {
  const attr = text(l['@_NAME']);
  if (attr) return attr;
  if (text(l.NAME)) return text(l.NAME);
  const lang = l['LANGUAGENAME.LIST'] as Node | undefined;
  const nm = lang?.['NAME.LIST'] as Node | undefined;
  const first = Array.isArray(nm?.NAME) ? (nm!.NAME as unknown[])[0] : nm?.NAME;
  return text(first);
}

export function parseTallyXml(xml: string): TallyResult {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    parseAttributeValue: false,
    processEntities: true,
    isArray: (name) => ARRAY_TAGS.has(name),
  });
  const valid = XMLValidator.validate(xml);
  if (valid !== true) {
    throw new Error(`This file is not valid XML: ${valid.err.msg} (line ${valid.err.line})`, {
      cause: valid.err,
    });
  }
  let doc: unknown;
  try {
    doc = parser.parse(xml);
  } catch (e) {
    throw new Error(`This file is not valid XML: ${(e as Error).message}`, { cause: e });
  }
  const skippedTags: Record<string, number> = {};
  const notes: string[] = [];
  const customers: TallyCustomer[] = [];
  const invoices: TallyInvoice[] = [];

  const ledgers: Node[] = [];
  collect(doc, 'LEDGER', ledgers);
  ledgers.forEach((l, i) => {
    const parent = text(l.PARENT);
    const name = ledgerName(l);
    if (!name) return;
    if (parent && !/sundry debtors/i.test(parent)) {
      notes.push(`Ledger "${name}" skipped: group is "${parent}", not Sundry Debtors`);
      return;
    }
    skipUnknown(l, LEDGER_KNOWN, skippedTags);
    const addr = l['ADDRESS.LIST'] as Node | undefined;
    const address = ((addr?.ADDRESS as unknown[]) ?? []).map(text).filter(Boolean).join(', ');
    customers.push({
      row: i + 1,
      values: {
        name,
        gstin: text(l.PARTYGSTIN) || text(l.GSTIN),
        phone: text(l.LEDGERPHONE) || text(l.LEDGERMOBILE),
        email: text(l.EMAIL),
        address,
        credit_days: text(l.BILLCREDITPERIOD),
      },
    });
  });

  const vouchers: Node[] = [];
  collect(doc, 'VOUCHER', vouchers);
  vouchers.forEach((v, i) => {
    const row = i + 1;
    const number = text(v.VOUCHERNUMBER);
    const type = text(v.VOUCHERTYPENAME);
    if (!/sales/i.test(type)) {
      notes.push(
        `Voucher ${number || `#${row}`} skipped: type "${type || 'unknown'}" is not a sales voucher`,
      );
      return;
    }
    if (/^yes$/i.test(text(v.ISCANCELLED))) {
      notes.push(`Voucher ${number} skipped: cancelled in Tally`);
      return;
    }
    skipUnknown(v, VOUCHER_KNOWN, skippedTags);
    const party = text(v.PARTYLEDGERNAME) || text(v.PARTYNAME);
    const entries: Node[] = [
      ...((v['ALLLEDGERENTRIES.LIST'] as Node[]) ?? []),
      ...((v['LEDGERENTRIES.LIST'] as Node[]) ?? []),
    ];
    let total = 0;
    let taxable = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    const toNum = (s: string) => Math.abs(Number(s.replace(/,/g, '')) || 0);
    const fmt = (n: number) => n.toFixed(2);
    for (const e of entries) {
      skipUnknown(e, ENTRY_KNOWN, skippedTags);
      const name = text(e.LEDGERNAME);
      const amt = toNum(text(e.AMOUNT));
      if (name === party) total = amt;
      else if (/igst/i.test(name)) igst += amt;
      else if (/cgst/i.test(name)) cgst += amt;
      else if (/sgst|utgst/i.test(name)) sgst += amt;
      else if (/round/i.test(name)) continue;
      else taxable += amt;
    }
    invoices.push({
      row,
      values: {
        number,
        date: text(v.DATE),
        dueDate: '',
        customerName: party,
        customerGstin: text(v.PARTYGSTIN),
        taxable: fmt(taxable),
        cgst: fmt(cgst),
        sgst: fmt(sgst),
        igst: fmt(igst),
        total: fmt(total),
      },
    });
  });

  return { customers, invoices, skippedTags, notes };
}
