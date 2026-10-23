import { addDays, daysBetween, type ISODate } from '@/lib/dates';
import { formatINR, paise } from '@/lib/money';
import { LEGAL_CONFIG } from './config';
import { NO_SENTENCES, result, type BuyerFacts, type InvoiceFacts, type LegalResult } from './common';

export interface Itc180Facts {
  date_180: ISODate | null;
  unpaid_gst_paise: number;
  days_left: number | null;
  [k: string]: string | number | boolean | null;
}

/**
 * Section 16(2) CGST Act read with Rule 37: a buyer who has not paid a supplier within 180 days
 * of the invoice date generally has to reverse the input tax credit on the unpaid portion.
 */
export function itc180(invoice: InvoiceFacts, buyer: BuyerFacts, today: ISODate): LegalResult<Itc180Facts> {
  const none: Itc180Facts = { date_180: null, unpaid_gst_paise: 0, days_left: null };
  if (!buyer.gstin) return result(false, 'Buyer has no GSTIN, so it cannot claim input tax credit.', none, NO_SENTENCES);
  if (invoice.invoice_type !== 'tax_invoice') return result(false, 'Not a tax invoice.', none, NO_SENTENCES);
  if (invoice.reverse_charge) return result(false, 'Reverse charge supply.', none, NO_SENTENCES);
  const unpaid = invoice.total_paise - invoice.paid_paise;
  if (unpaid <= 0 || invoice.total_paise <= 0) return result(false, 'Nothing unpaid.', none, NO_SENTENCES);
  const tax = invoice.cgst_paise + invoice.sgst_paise + invoice.igst_paise;
  const gst = paise(Math.round((tax * unpaid) / invoice.total_paise));
  const date = addDays(invoice.issue_date, LEGAL_CONFIG.itcDays);
  const left = daysBetween(today, date);
  const amt = formatINR(gst);
  const future = left >= 0;
  const en = future
    ? `Under Section 16(2) of the CGST Act read with Rule 37, a buyer generally needs to pay a supplier within 180 days of the invoice date, which for this invoice is ${date}; otherwise it may have to reverse input tax credit on the unpaid GST, currently about ${amt}.`
    : `Under Section 16(2) of the CGST Act read with Rule 37, a buyer generally needs to pay a supplier within 180 days of the invoice date; for this invoice that was ${date}, so the buyer may have to reverse input tax credit on the unpaid GST, about ${amt}, with interest.`;
  const hi = future
    ? `सीजीएसटी अधिनियम की धारा 16(2) और नियम 37 के अनुसार, खरीदार को आमतौर पर चालान की तारीख से 180 दिनों के भीतर भुगतान करना होता है, इस चालान के लिए यह ${date} है; अन्यथा अवैतनिक जीएसटी (लगभग ${amt}) पर इनपुट टैक्स क्रेडिट वापस करना पड़ सकता है।`
    : `सीजीएसटी अधिनियम की धारा 16(2) और नियम 37 के अनुसार, खरीदार को आमतौर पर चालान की तारीख से 180 दिनों के भीतर भुगतान करना होता है; इस चालान के लिए यह ${date} थी, इसलिए अवैतनिक जीएसटी (लगभग ${amt}) पर इनपुट टैक्स क्रेडिट ब्याज सहित वापस करना पड़ सकता है।`;
  const mr = future
    ? `सीजीएसटी कायद्याच्या कलम 16(2) आणि नियम 37 नुसार, खरेदीदाराने साधारणपणे बिलाच्या तारखेपासून 180 दिवसांत पैसे द्यावे लागतात, या बिलासाठी ही तारीख ${date} आहे; अन्यथा न भरलेल्या जीएसटीवरील (सुमारे ${amt}) इनपुट टॅक्स क्रेडिट परत करावे लागू शकते.`
    : `सीजीएसटी कायद्याच्या कलम 16(2) आणि नियम 37 नुसार, खरेदीदाराने साधारणपणे बिलाच्या तारखेपासून 180 दिवसांत पैसे द्यावे लागतात; या बिलासाठी ही तारीख ${date} होती, त्यामुळे न भरलेल्या जीएसटीवरील (सुमारे ${amt}) इनपुट टॅक्स क्रेडिट व्याजासह परत करावे लागू शकते.`;
  return result(true, 'Buyer has GSTIN, tax invoice, forward charge, unpaid balance.', { date_180: date, unpaid_gst_paise: gst, days_left: left }, { en, hi, mr });
}
