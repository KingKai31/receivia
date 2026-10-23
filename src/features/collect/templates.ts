import type { Stage } from './ladder';

export type Lang = 'en' | 'hi' | 'mr';

export const SLOTS = [
  'customer',
  'invoice_no',
  'amount_due',
  'due_date',
  'days_overdue',
  'pay_link',
  'lens_line',
  'contact',
] as const;
export type Slot = (typeof SLOTS)[number];
export type SlotValues = Record<Slot, string>;

/** Stages that produce a message to the buyer. next_steps is owner guidance only. */
export type MessageStage = Exclude<Stage, 'next_steps'>;

export const TEMPLATES: Record<MessageStage, Record<Lang, string>> = {
  pre_due: {
    en: 'Hello {{customer}}, a friendly note that invoice {{invoice_no}} for {{amount_due}} is due on {{due_date}}. You can pay here: {{pay_link}}\nQuestions? {{contact}}\nThank you.',
    hi: 'नमस्ते {{customer}}, यह एक विनम्र सूचना है कि चालान {{invoice_no}} की राशि {{amount_due}} {{due_date}} को देय है। यहाँ भुगतान करें: {{pay_link}}\nकोई प्रश्न? {{contact}}\nधन्यवाद।',
    mr: 'नमस्कार {{customer}}, ही एक नम्र आठवण की बिल {{invoice_no}} ची रक्कम {{amount_due}} {{due_date}} रोजी देय आहे. येथे पैसे भरा: {{pay_link}}\nकाही प्रश्न? {{contact}}\nधन्यवाद.',
  },
  due_today: {
    en: 'Hello {{customer}}, invoice {{invoice_no}} for {{amount_due}} is due today ({{due_date}}). You can pay here: {{pay_link}}\n{{contact}}',
    hi: 'नमस्ते {{customer}}, चालान {{invoice_no}} की राशि {{amount_due}} आज ({{due_date}}) देय है। यहाँ भुगतान करें: {{pay_link}}\n{{contact}}',
    mr: 'नमस्कार {{customer}}, बिल {{invoice_no}} ची रक्कम {{amount_due}} आज ({{due_date}}) देय आहे. येथे पैसे भरा: {{pay_link}}\n{{contact}}',
  },
  overdue_firm: {
    en: 'Dear {{customer}}, invoice {{invoice_no}} for {{amount_due}} was due on {{due_date}} and is now {{days_overdue}} days overdue. Please pay today, or tell us the date you will pay: {{pay_link}}\n{{lens_line}}\n{{contact}}',
    hi: 'प्रिय {{customer}}, चालान {{invoice_no}} की राशि {{amount_due}} {{due_date}} को देय थी और अब {{days_overdue}} दिन से अधिक देर हो चुकी है। कृपया आज भुगतान करें, या भुगतान की तारीख बताएँ: {{pay_link}}\n{{lens_line}}\n{{contact}}',
    mr: 'प्रिय {{customer}}, बिल {{invoice_no}} ची रक्कम {{amount_due}} {{due_date}} रोजी देय होती आणि आता {{days_overdue}} दिवस उशीर झाला आहे. कृपया आज पैसे भरा, किंवा पैसे कधी भरणार ती तारीख कळवा: {{pay_link}}\n{{lens_line}}\n{{contact}}',
  },
  final: {
    en: 'Dear {{customer}}, this is a final reminder. Invoice {{invoice_no}} for {{amount_due}} is {{days_overdue}} days overdue (due {{due_date}}). Please pay or call us today: {{pay_link}}\n{{lens_line}}\n{{contact}}',
    hi: 'प्रिय {{customer}}, यह अंतिम अनुस्मारक है। चालान {{invoice_no}} की राशि {{amount_due}} पर {{days_overdue}} दिन की देरी हो चुकी है (देय तिथि {{due_date}})। कृपया आज भुगतान करें या हमें फ़ोन करें: {{pay_link}}\n{{lens_line}}\n{{contact}}',
    mr: 'प्रिय {{customer}}, ही शेवटची आठवण आहे. बिल {{invoice_no}} ची रक्कम {{amount_due}} वर {{days_overdue}} दिवसांचा उशीर झाला आहे (देय तारीख {{due_date}}). कृपया आज पैसे भरा किंवा आम्हाला फोन करा: {{pay_link}}\n{{lens_line}}\n{{contact}}',
  },
  demand_letter: {
    en: 'Dear {{customer}}, we have prepared a Payment Demand Letter for invoice {{invoice_no}} ({{amount_due}}, due {{due_date}}, {{days_overdue}} days overdue). You can read it and pay here: {{pay_link}}\n{{lens_line}}\n{{contact}}',
    hi: 'प्रिय {{customer}}, हमने चालान {{invoice_no}} ({{amount_due}}, देय तिथि {{due_date}}, {{days_overdue}} दिन की देरी) के लिए भुगतान माँग पत्र (Payment Demand Letter) तैयार किया है। इसे पढ़ने और भुगतान करने के लिए: {{pay_link}}\n{{lens_line}}\n{{contact}}',
    mr: 'प्रिय {{customer}}, आम्ही बिल {{invoice_no}} ({{amount_due}}, देय तारीख {{due_date}}, {{days_overdue}} दिवस उशीर) साठी पेमेंट डिमांड लेटर (Payment Demand Letter) तयार केले आहे. ते वाचण्यासाठी आणि पैसे भरण्यासाठी: {{pay_link}}\n{{lens_line}}\n{{contact}}',
  },
};

export class TemplateError extends Error {}

/** Fills slots. Unknown slots or a missing value throw; an empty lens_line removes its line. */
export function renderTemplate(text: string, values: SlotValues): string {
  const out = text.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => {
    if (!(SLOTS as readonly string[]).includes(name))
      throw new TemplateError(`Unknown slot ${name}`);
    const v = values[name as Slot];
    if (v === undefined) throw new TemplateError(`Missing slot ${name}`);
    return v;
  });
  return out
    .split('\n')
    .filter((l) => l.trim() !== '')
    .join('\n')
    .trim();
}

export function buildMessage(stage: MessageStage, lang: Lang, values: SlotValues): string {
  return renderTemplate(TEMPLATES[stage][lang] ?? TEMPLATES[stage].en, values);
}

// ---- Send rules ----------------------------------------------------------

export const QUIET_START_HOUR = 21;
export const QUIET_END_HOUR = 9;

/** Hour of day (0-23) in IST for an instant. */
export function istHour(now: Date): number {
  return new Date(now.getTime() + 5.5 * 3600_000).getUTCHours();
}

export function inQuietHours(now: Date): boolean {
  const h = istHour(now);
  return h >= QUIET_START_HOUR || h < QUIET_END_HOUR;
}

export interface SendCheck {
  ok: boolean;
  reason?: string;
}

/** Max one message per customer per IST day; none during quiet hours (21:00-09:00 IST). */
export function canSend(args: { now: Date; sentTodayToCustomer: number }): SendCheck {
  if (inQuietHours(args.now))
    return { ok: false, reason: 'Quiet hours: messages go out between 09:00 and 21:00 IST.' };
  if (args.sentTodayToCustomer >= 1)
    return { ok: false, reason: 'This customer already has a message today.' };
  return { ok: true };
}

export function whatsappUrl(phone: string, text: string): string {
  const digits = phone.replace(/\D/g, '');
  const full = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${full}?text=${encodeURIComponent(text)}`;
}
export function mailtoUrl(email: string, subject: string, body: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
export function smsUrl(phone: string, body: string): string {
  return `sms:${phone.replace(/[^\d+]/g, '')}?body=${encodeURIComponent(body)}`;
}
