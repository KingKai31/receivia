import { GENERAL_INFO_HI, GENERAL_INFO_LINE, GENERAL_INFO_MR, type Sentences } from './common';

/** Buyer facts that decide the government / PSU path. */
export interface GovBuyer {
  entity_type?: string | null;
  is_psu?: boolean | null;
}

/** Government department or a PSU/CPSE: formal ladder, bill-tracking, escalation steps. */
export function isGovernmentPath(b: GovBuyer): boolean {
  return b.entity_type === 'government' || Boolean(b.is_psu);
}

/** PSU flag: treated as a company / CPSE buyer for Form I and TReDS wording. */
export function isCpse(b: GovBuyer): boolean {
  return Boolean(b.is_psu);
}

const tail = (s: Sentences): Sentences => ({
  en: `${s.en} ${GENERAL_INFO_LINE}`,
  hi: `${s.hi} ${GENERAL_INFO_HI}`,
  mr: `${s.mr} ${GENERAL_INFO_MR}`,
});

export const FORM_I_REMINDER: Sentences = tail({
  en: "A company buyer may have to report supplier amounts outstanding for more than 45 days in MSME Form I (Section 9 of the MSMED Act). It may be worth mentioning this to the buyer's accounts team.",
  hi: 'कंपनी खरीदार को 45 दिन से अधिक बकाया आपूर्तिकर्ता राशि MSME फ़ॉर्म I (MSMED अधिनियम की धारा 9) में बतानी पड़ सकती है। यह बात खरीदार की लेखा टीम को बताना उपयोगी हो सकता है।',
  mr: 'कंपनी खरेदीदाराला 45 दिवसांपेक्षा जास्त थकीत पुरवठादार रक्कम MSME फॉर्म I (MSMED कायद्याचे कलम 9) मध्ये कळवावी लागू शकते. हे खरेदीदाराच्या लेखा विभागाला सांगणे उपयुक्त ठरू शकते.',
});

export const TREDS_NOTE: Sentences = tail({
  en: 'Central public sector enterprises (CPSE) are generally expected to register on a TReDS platform, so this invoice may be eligible to be listed for early payment through a financier. Confirm with your bank or the platform.',
  hi: 'केंद्रीय सार्वजनिक क्षेत्र के उपक्रमों (CPSE) से आम तौर पर TReDS मंच पर पंजीकृत होने की अपेक्षा की जाती है, इसलिए यह चालान वित्तदाता के माध्यम से जल्दी भुगतान के लिए सूचीबद्ध हो सकता है। अपने बैंक या मंच से पुष्टि करें।',
  mr: 'केंद्रीय सार्वजनिक क्षेत्रातील उपक्रमांनी (CPSE) साधारणपणे TReDS मंचावर नोंदणी करणे अपेक्षित असते, त्यामुळे हे बिल वित्तदात्यामार्फत लवकर पैसे मिळण्यासाठी नोंदवता येऊ शकते. आपल्या बँकेकडे किंवा मंचाकडे खात्री करा.',
});

export interface EscalationStep {
  key: 'nodal' | 'samadhaan' | 'cpgrams';
  title: Sentences;
  checklist: Sentences[];
}

export const ESCALATION: EscalationStep[] = [
  {
    key: 'nodal',
    title: {
      en: "Step 1: write to the department's nodal officer for payments",
      hi: 'चरण 1: विभाग के भुगतान नोडल अधिकारी को लिखें',
      mr: 'पायरी 1: विभागाच्या देयक नोडल अधिकाऱ्याला लिहा',
    },
    checklist: [
      {
        en: 'Find the nodal officer or accounts head named in the purchase order or on the department website.',
        hi: 'खरीद आदेश या विभाग की वेबसाइट से नोडल अधिकारी या लेखा प्रमुख का नाम खोजें।',
        mr: 'खरेदी आदेश किंवा विभागाच्या संकेतस्थळावरून नोडल अधिकारी किंवा लेखा प्रमुखाचे नाव शोधा.',
      },
      {
        en: 'Send the bill-tracking reference, invoice copies, work-completion or delivery proof and the amount due.',
        hi: 'बिल-ट्रैकिंग संदर्भ, चालान की प्रतियाँ, कार्य-पूर्णता या डिलीवरी का प्रमाण और बकाया राशि भेजें।',
        mr: 'बिल-ट्रॅकिंग संदर्भ, बिलांच्या प्रती, काम पूर्ण झाल्याचा किंवा डिलिव्हरीचा पुरावा आणि थकीत रक्कम पाठवा.',
      },
      {
        en: 'Ask for the date on which payment will be released and keep the reply.',
        hi: 'भुगतान जारी होने की तारीख पूछें और उत्तर सुरक्षित रखें।',
        mr: 'पैसे कधी दिले जातील ती तारीख विचारा आणि उत्तर जपून ठेवा.',
      },
    ],
  },
  {
    key: 'samadhaan',
    title: {
      en: 'Step 2: file a reference on MSME Samadhaan (if you are an eligible MSME)',
      hi: 'चरण 2: MSME समाधान पर संदर्भ दर्ज करें (यदि आप पात्र MSME हैं)',
      mr: 'पायरी 2: MSME समाधान वर संदर्भ नोंदवा (तुम्ही पात्र MSME असाल तर)',
    },
    checklist: [
      {
        en: 'Keep the Udyam certificate, invoices, proof of delivery and the case pack ready.',
        hi: 'उद्यम प्रमाणपत्र, चालान, डिलीवरी का प्रमाण और केस पैक तैयार रखें।',
        mr: 'उद्यम प्रमाणपत्र, बिले, डिलिव्हरीचा पुरावा आणि केस पॅक तयार ठेवा.',
      },
      {
        en: 'Register the reference at samadhaan.msme.gov.in; the portal may ask for more documents.',
        hi: 'samadhaan.msme.gov.in पर संदर्भ दर्ज करें; पोर्टल और दस्तावेज़ माँग सकता है।',
        mr: 'samadhaan.msme.gov.in वर संदर्भ नोंदवा; पोर्टल आणखी कागदपत्रे मागू शकते.',
      },
      {
        en: 'Note the reference number and follow its status.',
        hi: 'संदर्भ संख्या लिखें और उसकी स्थिति देखते रहें।',
        mr: 'संदर्भ क्रमांक लिहून ठेवा आणि स्थिती पाहत राहा.',
      },
    ],
  },
  {
    key: 'cpgrams',
    title: {
      en: 'Step 3: lodge a grievance on CPGRAMS',
      hi: 'चरण 3: CPGRAMS पर शिकायत दर्ज करें',
      mr: 'पायरी 3: CPGRAMS वर तक्रार नोंदवा',
    },
    checklist: [
      {
        en: 'Use pgportal.gov.in and choose the ministry or department that owes the payment.',
        hi: 'pgportal.gov.in का उपयोग करें और भुगतान देने वाला मंत्रालय या विभाग चुनें।',
        mr: 'pgportal.gov.in वापरा आणि पैसे देणारे मंत्रालय किंवा विभाग निवडा.',
      },
      {
        en: 'Attach the nodal officer letter, the Samadhaan reference number (if any) and the invoices.',
        hi: 'नोडल अधिकारी को भेजा पत्र, समाधान संदर्भ संख्या (यदि हो) और चालान संलग्न करें।',
        mr: 'नोडल अधिकाऱ्याला दिलेले पत्र, समाधान संदर्भ क्रमांक (असल्यास) आणि बिले जोडा.',
      },
      {
        en: 'Keep the grievance registration number for follow-up.',
        hi: 'अनुवर्तन के लिए शिकायत पंजीकरण संख्या सुरक्षित रखें।',
        mr: 'पाठपुराव्यासाठी तक्रार नोंदणी क्रमांक जपून ठेवा.',
      },
    ],
  },
];

/** What the government path adds to a buyer's guidance and case pack. */
export function governmentGuide(b: GovBuyer): {
  formI: Sentences | null;
  treds: Sentences | null;
  steps: EscalationStep[];
} {
  return {
    formI: isCpse(b) ? FORM_I_REMINDER : null,
    treds: isCpse(b) ? TREDS_NOTE : null,
    steps: ESCALATION,
  };
}

/** Formal wording for reminder stages. Same slots as the standard templates. */
export const FORMAL_TEMPLATES = {
  pre_due: {
    en: 'Respected Sir/Madam, this is to inform you that invoice {{invoice_no}} for {{amount_due}} of {{customer}} falls due on {{due_date}}. Kindly arrange release of payment.\nPayment details: {{pay_link}}\n{{contact}}',
    hi: 'आदरणीय महोदय/महोदया, सूचित किया जाता है कि {{customer}} का चालान {{invoice_no}} राशि {{amount_due}} {{due_date}} को देय है। कृपया भुगतान जारी करने की व्यवस्था करें।\nभुगतान विवरण: {{pay_link}}\n{{contact}}',
    mr: 'आदरणीय महोदय/महोदया, कळविण्यात येते की {{customer}} चे बिल {{invoice_no}} रक्कम {{amount_due}} {{due_date}} रोजी देय आहे. कृपया देयक अदा करण्याची व्यवस्था करावी.\nदेयक तपशील: {{pay_link}}\n{{contact}}',
  },
  due_today: {
    en: 'Respected Sir/Madam, invoice {{invoice_no}} for {{amount_due}} falls due today ({{due_date}}). Kindly arrange release of payment.\nPayment details: {{pay_link}}\n{{contact}}',
    hi: 'आदरणीय महोदय/महोदया, चालान {{invoice_no}} राशि {{amount_due}} आज ({{due_date}}) देय है। कृपया भुगतान जारी करने की व्यवस्था करें।\nभुगतान विवरण: {{pay_link}}\n{{contact}}',
    mr: 'आदरणीय महोदय/महोदया, बिल {{invoice_no}} रक्कम {{amount_due}} आज ({{due_date}}) देय आहे. कृपया देयक अदा करण्याची व्यवस्था करावी.\nदेयक तपशील: {{pay_link}}\n{{contact}}',
  },
  overdue_firm: {
    en: 'Respected Sir/Madam, invoice {{invoice_no}} for {{amount_due}} was due on {{due_date}} and has remained unpaid for {{days_overdue}} days. We request you to kindly expedite release of payment or inform us of the status of the bill.\nPayment details: {{pay_link}}\n{{lens_line}}\n{{contact}}',
    hi: 'आदरणीय महोदय/महोदया, चालान {{invoice_no}} राशि {{amount_due}} {{due_date}} को देय था और {{days_overdue}} दिन से अधिक से अदत्त है। कृपया भुगतान शीघ्र जारी करें या बिल की स्थिति से अवगत कराएँ।\nभुगतान विवरण: {{pay_link}}\n{{lens_line}}\n{{contact}}',
    mr: 'आदरणीय महोदय/महोदया, बिल {{invoice_no}} रक्कम {{amount_due}} {{due_date}} रोजी देय होते आणि {{days_overdue}} दिवस थकीत आहे. कृपया देयक लवकर अदा करावे किंवा बिलाची स्थिती कळवावी.\nदेयक तपशील: {{pay_link}}\n{{lens_line}}\n{{contact}}',
  },
  final: {
    en: 'Respected Sir/Madam, this is a final reminder. Invoice {{invoice_no}} for {{amount_due}} has remained unpaid for {{days_overdue}} days (due {{due_date}}). We request you to kindly release payment, or to speak to us, at the earliest.\nPayment details: {{pay_link}}\n{{lens_line}}\n{{contact}}',
    hi: 'आदरणीय महोदय/महोदया, यह अंतिम अनुस्मारक है। चालान {{invoice_no}} राशि {{amount_due}} {{days_overdue}} दिन से अदत्त है (देय तिथि {{due_date}})। कृपया शीघ्र भुगतान जारी करें या हमसे बात करें।\nभुगतान विवरण: {{pay_link}}\n{{lens_line}}\n{{contact}}',
    mr: 'आदरणीय महोदय/महोदया, ही शेवटची आठवण आहे. बिल {{invoice_no}} रक्कम {{amount_due}} {{days_overdue}} दिवस थकीत आहे (देय तारीख {{due_date}}). कृपया लवकर देयक अदा करावे किंवा आमच्याशी संपर्क साधावा.\nदेयक तपशील: {{pay_link}}\n{{lens_line}}\n{{contact}}',
  },
  demand_letter: {
    en: 'Respected Sir/Madam, we have prepared a Payment Demand Letter for invoice {{invoice_no}} ({{amount_due}}, due {{due_date}}, {{days_overdue}} days overdue). Kindly read it and arrange payment.\nPayment details: {{pay_link}}\n{{lens_line}}\n{{contact}}',
    hi: 'आदरणीय महोदय/महोदया, हमने चालान {{invoice_no}} ({{amount_due}}, देय तिथि {{due_date}}, {{days_overdue}} दिन की देरी) के लिए भुगतान माँग पत्र (Payment Demand Letter) तैयार किया है। कृपया इसे पढ़कर भुगतान की व्यवस्था करें।\nभुगतान विवरण: {{pay_link}}\n{{lens_line}}\n{{contact}}',
    mr: 'आदरणीय महोदय/महोदया, आम्ही बिल {{invoice_no}} ({{amount_due}}, देय तारीख {{due_date}}, {{days_overdue}} दिवस उशीर) साठी पेमेंट डिमांड लेटर (Payment Demand Letter) तयार केले आहे. कृपया ते वाचून देयक अदा करावे.\nदेयक तपशील: {{pay_link}}\n{{lens_line}}\n{{contact}}',
  },
} as const;
