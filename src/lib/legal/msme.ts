import { addDays, daysBetween, type ISODate } from '@/lib/dates';
import { formatINR, paise, type Paise } from '@/lib/money';
import { LEGAL_CONFIG } from './config';
import { NO_SENTENCES, result, type BuyerFacts, type LegalResult, type SellerFacts } from './common';

/** Udyam number AND micro/small AND manufacturing/services (not trading). */
export function msmeEligibility(b: SellerFacts): LegalResult<{ eligible: boolean }> {
  const udyam = Boolean(b.udyam_number && b.udyam_number.trim());
  const size = b.enterprise_size === 'micro' || b.enterprise_size === 'small';
  const activity = b.activity === 'manufacturing' || b.activity === 'services';
  const ok = udyam && size && activity;
  const reason = ok
    ? 'Udyam number present, micro or small, manufacturing or services.'
    : !udyam
      ? 'No Udyam number.'
      : !size
        ? 'Enterprise size is not micro or small.'
        : 'Activity is not manufacturing or services (traders are generally outside the MSMED Act payment rules).';
  return result(ok, reason, { eligible: ok }, {
    en: 'Your Udyam registration, size and activity suggest you may be a supplier covered by the payment-time rules of the MSMED Act, 2006 (Sections 15 and 16).',
    hi: 'आपका उद्यम पंजीकरण, आकार और गतिविधि दर्शाते हैं कि आप एमएसएमईडी अधिनियम, 2006 (धारा 15 और 16) के भुगतान-समय नियमों के अंतर्गत आने वाले आपूर्तिकर्ता हो सकते हैं।',
    mr: 'तुमची उद्यम नोंदणी, आकार आणि व्यवसाय पाहता तुम्ही एमएसएमईडी कायदा, 2006 (कलम 15 आणि 16) मधील पेमेंट-वेळेच्या नियमांखाली येणारे पुरवठादार असू शकता.',
  });
}

/**
 * MSMED Act s.15: due on the agreed date, at most 45 days from acceptance and only with a written
 * agreement; with no written agreement, 15 days from acceptance.
 */
export function msmeDueDate(accepted: ISODate, agreedDays: number, hasWrittenAgreement: boolean): ISODate {
  const days = hasWrittenAgreement
    ? Math.min(Math.max(agreedDays, 0), LEGAL_CONFIG.msmeMaxAgreedDays)
    : LEGAL_CONFIG.msmeDefaultDays;
  return addDays(accepted, days);
}

export interface Sec43bhFacts {
  msme_due_date: ISODate | null;
  certainty: 'firm' | 'soft' | 'none';
  [k: string]: string | number | boolean | null;
}

/** Section 43B(h) Income-tax Act: buyer's deduction for dues to micro/small suppliers moves to the payment year once past the MSMED limit. */
export function sec43bh(args: {
  seller: SellerFacts;
  buyer: BuyerFacts;
  msmeDue: ISODate;
  today: ISODate;
}): LegalResult<Sec43bhFacts> {
  const { seller, buyer, msmeDue, today } = args;
  const no = (reason: string) => result<Sec43bhFacts>(false, reason, { msme_due_date: msmeDue, certainty: 'none' }, NO_SENTENCES);
  if (!msmeEligibility(seller).applies) return no('Seller is not an eligible micro/small manufacturing or services enterprise.');
  if (buyer.entity_type === 'individual') return no('Buyer is an individual consumer.');
  if (buyer.entity_type === 'government') return no('Buyer is a government body, which does not claim business deductions.');
  if (buyer.presumptive_tax === 'yes') return no('Buyer is taxed on a presumptive basis, so a deduction timing rule does not bite.');
  const soft = buyer.presumptive_tax === 'unknown';
  const past = today > msmeDue;
  const when = past ? `which passed on ${msmeDue}` : `which falls on ${msmeDue}`;
  const whenHi = past ? `जो ${msmeDue} को बीत चुकी है` : `जो ${msmeDue} को है`;
  const whenMr = past ? `जी ${msmeDue} रोजी उलटून गेली आहे` : `जी ${msmeDue} रोजी आहे`;
  const en = soft
    ? `If your business is not taxed on a presumptive basis, Section 43B(h) of the Income-tax Act may allow a deduction for this purchase only in the year it is actually paid when payment goes beyond the MSMED due date (${when}); please check with your tax adviser.`
    : `Section 43B(h) of the Income-tax Act generally allows a deduction for purchases from micro and small enterprises only in the year of actual payment when payment goes beyond the MSMED due date (${when}), so late payment may defer your tax deduction.`;
  const hi = soft
    ? `यदि आपके व्यवसाय पर अनुमानित आधार पर कर नहीं लगता, तो आयकर अधिनियम की धारा 43B(h) के अनुसार एमएसएमईडी देय तिथि (${whenHi}) के बाद भुगतान होने पर इस खरीद की कटौती केवल वास्तविक भुगतान वाले वर्ष में मिल सकती है; कृपया अपने कर सलाहकार से जाँच करें।`
    : `आयकर अधिनियम की धारा 43B(h) के अनुसार सूक्ष्म और लघु उद्यमों से खरीद की कटौती, एमएसएमईडी देय तिथि (${whenHi}) के बाद भुगतान होने पर, आमतौर पर केवल वास्तविक भुगतान वाले वर्ष में मिलती है, इसलिए देर से भुगतान से आपकी कर कटौती टल सकती है।`;
  const mr = soft
    ? `तुमच्या व्यवसायावर अनुमानित पद्धतीने कर आकारला जात नसेल, तर प्राप्तिकर कायद्याच्या कलम 43B(h) नुसार एमएसएमईडी देय तारखेनंतर (${whenMr}) पैसे दिल्यास या खरेदीची वजावट प्रत्यक्ष पैसे दिलेल्या वर्षातच मिळू शकते; कृपया तुमच्या कर सल्लागाराकडे तपासा.`
    : `प्राप्तिकर कायद्याच्या कलम 43B(h) नुसार सूक्ष्म व लघु उद्योगांकडून केलेल्या खरेदीची वजावट, एमएसएमईडी देय तारखेनंतर (${whenMr}) पैसे दिल्यास, साधारणपणे प्रत्यक्ष पैसे दिलेल्या वर्षातच मिळते, त्यामुळे उशिरा पेमेंटमुळे तुमची कर वजावट पुढे ढकलली जाऊ शकते.`;
  return result<Sec43bhFacts>(true, soft ? 'Eligible seller; buyer presumptive status unknown (softer wording).' : 'Eligible seller; buyer not on presumptive tax.', { msme_due_date: msmeDue, certainty: soft ? 'soft' : 'firm' }, { en, hi, mr });
}

/** MSME Form I (Companies Act, 2013 s.405 order): a company buyer with MSME dues unpaid past the limit. */
export function msmeForm1(args: { buyer: BuyerFacts; msmeDue: ISODate; today: ISODate }): LegalResult<{ days_past: number }> {
  const { buyer, msmeDue, today } = args;
  const past = daysBetween(msmeDue, today);
  if (buyer.entity_type !== 'company') return result(false, 'Buyer is not a company.', { days_past: Math.max(past, 0) }, NO_SENTENCES);
  if (past <= 0) return result(false, 'Not past the MSME due date.', { days_past: 0 }, NO_SENTENCES);
  return result(true, 'Company buyer past the MSME due date.', { days_past: past }, {
    en: 'A company that owes an MSME supplier money beyond the MSMED due date (Section 15) may have to report it in MSME Form I under the Companies Act, 2013 (Section 405 and the related order), which is generally filed half-yearly.',
    hi: 'जो कंपनी किसी एमएसएमई आपूर्तिकर्ता को एमएसएमईडी देय तिथि (धारा 15) के बाद भी भुगतान नहीं करती, उसे कंपनी अधिनियम, 2013 (धारा 405 और संबंधित आदेश) के तहत एमएसएमई फॉर्म I में इसकी जानकारी देनी पड़ सकती है, जो आमतौर पर छमाही दाखिल होता है।',
    mr: 'जी कंपनी एमएसएमई पुरवठादाराचे पैसे एमएसएमईडी देय तारखेनंतरही (कलम 15) देत नाही, तिला कंपनी कायदा, 2013 (कलम 405 आणि संबंधित आदेश) अंतर्गत एमएसएमई फॉर्म I मध्ये ते कळवावे लागू शकते, जो साधारणपणे सहामाही भरला जातो.',
  });
}

export interface InterestResult {
  interest_paise: Paise;
  months: number;
  days: number;
  annual_rate_pct: number;
}

function addMonths(d: ISODate, n: number): ISODate {
  const [y, m, day] = d.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(day, last))).toISOString().slice(0, 10);
}

/**
 * MSMED Act s.16: compound interest with monthly rests at three times the RBI bank rate, from the
 * due date. Each completed month's interest joins the base before the next month starts.
 */
export function msmedInterest(args: {
  principal: Paise;
  dueDate: ISODate;
  asOf: ISODate;
  bankRatePct?: number;
}): InterestResult {
  const rate = (args.bankRatePct ?? LEGAL_CONFIG.rbiBankRatePct) * LEGAL_CONFIG.interestMultiple;
  const total = daysBetween(args.dueDate, args.asOf);
  if (total <= 0 || args.principal <= 0) {
    return { interest_paise: paise(0), months: 0, days: Math.max(total, 0), annual_rate_pct: rate };
  }
  let base = args.principal as number;
  let start = args.dueDate;
  let months = 0;
  for (;;) {
    const next = addMonths(args.dueDate, months + 1);
    if (next > args.asOf) break;
    base += Math.round((base * rate * daysBetween(start, next)) / 36500);
    start = next;
    months += 1;
  }
  base += Math.round((base * rate * daysBetween(start, args.asOf)) / 36500);
  return { interest_paise: paise(base - args.principal), months, days: total, annual_rate_pct: rate };
}

export function describeInterest(i: InterestResult): string {
  return `Interest at ${i.annual_rate_pct}% a year (3 × RBI bank rate), compounded monthly, for ${i.days} day(s): ${formatINR(i.interest_paise)}. Check the current bank rate at rbi.org.in.`;
}
