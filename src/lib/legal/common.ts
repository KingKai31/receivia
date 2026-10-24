import type { ISODate } from '@/lib/dates';

export const GENERAL_INFO_LINE = 'General information, not legal or tax advice.';
export const GENERAL_INFO_HI = 'सामान्य जानकारी, कानूनी या कर सलाह नहीं।';
export const GENERAL_INFO_MR = 'सामान्य माहिती, कायदेशीर किंवा कर सल्ला नाही.';

export interface LegalResult<F = Record<string, string | number | boolean | null>> {
  applies: boolean;
  reason: string;
  facts: F;
  sentence_en: string;
  sentence_hi: string;
  sentence_mr: string;
}

export interface Sentences {
  en: string;
  hi: string;
  mr: string;
}

export const NO_SENTENCES: Sentences = { en: '', hi: '', mr: '' };

/** Appends the disclaimer in each language. */
export function withDisclaimer(s: Sentences): Sentences {
  return {
    en: `${s.en} ${GENERAL_INFO_LINE}`,
    hi: `${s.hi} ${GENERAL_INFO_HI}`,
    mr: `${s.mr} ${GENERAL_INFO_MR}`,
  };
}

export function result<F>(
  applies: boolean,
  reason: string,
  facts: F,
  s: Sentences,
): LegalResult<F> {
  const t = applies ? withDisclaimer(s) : NO_SENTENCES;
  return { applies, reason, facts, sentence_en: t.en, sentence_hi: t.hi, sentence_mr: t.mr };
}

export type EntityType = 'company' | 'firm' | 'proprietor' | 'government' | 'individual';
export type Presumptive = 'unknown' | 'yes' | 'no';

export interface BuyerFacts {
  gstin: string | null;
  entity_type: EntityType | null;
  presumptive_tax: Presumptive;
  credit_days: number;
  has_written_agreement: boolean;
}

export interface InvoiceFacts {
  invoice_type: 'tax_invoice' | 'bill_of_supply' | 'invoice';
  issue_date: ISODate;
  accepted_on?: ISODate | null;
  acceptance_source?: 'buyer_confirmed' | 'proof_uploaded' | 'assumed_delivery_date' | null;
  total_paise: number;
  paid_paise: number;
  credited_paise?: number;
  tds_paise?: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  reverse_charge: boolean;
}

export interface SellerFacts {
  udyam_number: string | null;
  enterprise_size: 'micro' | 'small' | 'medium' | null;
  activity: 'manufacturing' | 'services' | 'trading' | null;
}
