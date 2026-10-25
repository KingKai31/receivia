import type { ISODate } from '@/lib/dates';
import { acceptanceOf } from './acceptance';
import { itc180 } from './itc180';
import { msmeDueDate, msmeForm1, sec43bh } from './msme';
import type { BuyerFacts, InvoiceFacts, LegalResult, SellerFacts } from './common';

export interface Lens {
  source: 'sec43bh' | 'itc180' | null;
  line_en: string;
  line_hi: string;
  line_mr: string;
  msme_due: ISODate;
  /** True when the acceptance date is not confirmed by the buyer or by proof. */
  msme_due_assumed: boolean;
  form1: LegalResult<{ days_past: number }>;
}

/**
 * Buyer Compliance Lens: the single most useful buyer-side sentence for a reminder.
 * MSME suppliers get Section 43B(h); everyone else with a GSTIN gets the 180 day ITC rule.
 */
export function buyerLens(args: {
  seller: SellerFacts;
  buyer: BuyerFacts;
  invoice: InvoiceFacts;
  today: ISODate;
}): Lens {
  const { seller, buyer, invoice, today } = args;
  const msme_due = msmeDueDate(
    acceptanceOf(invoice).date,
    buyer.credit_days,
    buyer.has_written_agreement,
  );
  const a = sec43bh({ seller, buyer, msmeDue: msme_due, today });
  const b = itc180(invoice, buyer, today);
  const form1 = msmeForm1({ buyer, msmeDue: msme_due, today });
  const pick = a.applies ? a : b.applies ? b : null;
  return {
    source: pick === a ? 'sec43bh' : pick === b ? 'itc180' : null,
    line_en: pick?.sentence_en ?? '',
    line_hi: pick?.sentence_hi ?? '',
    line_mr: pick?.sentence_mr ?? '',
    msme_due,
    msme_due_assumed: acceptanceOf(invoice).assumed,
    form1,
  };
}
