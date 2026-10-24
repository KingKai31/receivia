export type PayLang = 'en' | 'hi' | 'mr';

export interface PayStrings {
  invoice: string;
  amountDue: string;
  dueOn: string;
  fullyPaid: string;
  upiTitle: string;
  upiButton: string;
  upiQrAlt: string;
  online: string;
  onlineNotConfigured: string;
  testMode: string;
  alreadyPaid: string;
  reference: string;
  paidOn: string;
  send: string;
  wrong: string;
  reason: string;
  reasons: [string, string][];
  note: string;
  willPay: string;
  payDate: string;
  thanks: string;
  paused: string;
  claimPending: string;
  disputeOpen: string;
  replyHeading: string;
  lensHeading: string;
  notFound: string;
  loading: string;
  error: string;
  tooMany: string;
  contact: string;
}

export const PAY_TEXT: Record<PayLang, PayStrings> = {
  en: {
    invoice: 'Invoice',
    amountDue: 'Amount due',
    dueOn: 'Due on',
    fullyPaid: 'This invoice is fully paid. Thank you.',
    upiTitle: 'Pay by UPI',
    upiButton: 'Open UPI app',
    upiQrAlt: 'UPI QR code for the amount due',
    online: 'Pay online',
    onlineNotConfigured: 'Online payment not configured',
    testMode: 'Test mode',
    alreadyPaid: "I've already paid",
    reference: 'Payment reference (UTR or cheque number)',
    paidOn: 'Date you paid',
    send: 'Send',
    wrong: "Something's wrong",
    reason: 'What is wrong?',
    reasons: [
      ['quantity', 'Quantity or goods not as ordered'],
      ['price', 'Price or tax is wrong'],
      ['not_received', 'Goods or service not received'],
      ['duplicate', 'Billed twice'],
      ['other', 'Something else'],
    ],
    note: 'More details (optional)',
    willPay: "I'll pay on",
    payDate: 'Date',
    thanks: 'Thank you. We have noted this and reminders are paused while we look into it.',
    paused: 'Reminders for this invoice are paused.',
    claimPending: 'You told us you have paid. We are checking.',
    disputeOpen: 'You told us something is wrong. We are looking into it.',
    replyHeading: 'Reply from the business',
    lensHeading: 'Good to know for your accounts',
    notFound: 'This link is not valid or has expired. Please ask the business for a new one.',
    loading: 'Loading…',
    error: 'Something went wrong. Please try again.',
    tooMany: 'Too many attempts. Please wait a few minutes and try again.',
    contact: 'Contact',
  },
  hi: {
    invoice: 'चालान',
    amountDue: 'देय राशि',
    dueOn: 'देय तिथि',
    fullyPaid: 'यह चालान पूरा चुकाया जा चुका है। धन्यवाद।',
    upiTitle: 'यूपीआई से भुगतान करें',
    upiButton: 'यूपीआई ऐप खोलें',
    upiQrAlt: 'देय राशि के लिए यूपीआई क्यूआर कोड',
    online: 'ऑनलाइन भुगतान करें',
    onlineNotConfigured: 'ऑनलाइन भुगतान चालू नहीं है',
    testMode: 'टेस्ट मोड',
    alreadyPaid: 'मैं पहले ही भुगतान कर चुका/चुकी हूँ',
    reference: 'भुगतान संदर्भ (यूटीआर या चेक नंबर)',
    paidOn: 'भुगतान की तारीख',
    send: 'भेजें',
    wrong: 'कुछ गड़बड़ है',
    reason: 'क्या गड़बड़ है?',
    reasons: [
      ['quantity', 'मात्रा या माल ऑर्डर के अनुसार नहीं'],
      ['price', 'कीमत या कर गलत है'],
      ['not_received', 'माल या सेवा नहीं मिली'],
      ['duplicate', 'दो बार बिल बना है'],
      ['other', 'कुछ और'],
    ],
    note: 'और जानकारी (वैकल्पिक)',
    willPay: 'मैं इस तारीख को भुगतान करूँगा/करूँगी',
    payDate: 'तारीख',
    thanks: 'धन्यवाद। हमने इसे दर्ज कर लिया है और जाँच के दौरान रिमाइंडर रुके रहेंगे।',
    paused: 'इस चालान के रिमाइंडर रुके हुए हैं।',
    claimPending: 'आपने बताया कि भुगतान हो चुका है। हम जाँच रहे हैं।',
    disputeOpen: 'आपने बताया कि कुछ गड़बड़ है। हम देख रहे हैं।',
    replyHeading: 'व्यवसाय का उत्तर',
    lensHeading: 'आपके खातों के लिए जानने योग्य',
    notFound: 'यह लिंक मान्य नहीं है या समाप्त हो गया है। कृपया व्यवसाय से नया लिंक माँगें।',
    loading: 'लोड हो रहा है…',
    error: 'कुछ गलत हो गया। कृपया फिर कोशिश करें।',
    tooMany: 'बहुत अधिक प्रयास। कृपया कुछ मिनट रुककर फिर कोशिश करें।',
    contact: 'संपर्क',
  },
  mr: {
    invoice: 'बिल',
    amountDue: 'देय रक्कम',
    dueOn: 'देय तारीख',
    fullyPaid: 'हे बिल पूर्ण भरले आहे. धन्यवाद.',
    upiTitle: 'यूपीआयने पैसे भरा',
    upiButton: 'यूपीआय अॅप उघडा',
    upiQrAlt: 'देय रकमेसाठी यूपीआय क्यूआर कोड',
    online: 'ऑनलाइन पैसे भरा',
    onlineNotConfigured: 'ऑनलाइन पेमेंट सुरू केलेले नाही',
    testMode: 'टेस्ट मोड',
    alreadyPaid: 'मी आधीच पैसे भरले आहेत',
    reference: 'पेमेंट संदर्भ (यूटीआर किंवा चेक नंबर)',
    paidOn: 'पैसे भरल्याची तारीख',
    send: 'पाठवा',
    wrong: 'काहीतरी चुकले आहे',
    reason: 'काय चुकले आहे?',
    reasons: [
      ['quantity', 'प्रमाण किंवा माल ऑर्डरप्रमाणे नाही'],
      ['price', 'किंमत किंवा कर चुकीचा आहे'],
      ['not_received', 'माल किंवा सेवा मिळाली नाही'],
      ['duplicate', 'दोनदा बिल केले आहे'],
      ['other', 'दुसरे काही'],
    ],
    note: 'अधिक माहिती (ऐच्छिक)',
    willPay: 'मी या तारखेला पैसे भरीन',
    payDate: 'तारीख',
    thanks: 'धन्यवाद. आम्ही हे नोंदवले आहे आणि तपासणी सुरू असताना रिमाइंडर थांबवले आहेत.',
    paused: 'या बिलाचे रिमाइंडर थांबवले आहेत.',
    claimPending: 'तुम्ही पैसे भरल्याचे सांगितले. आम्ही तपासत आहोत.',
    disputeOpen: 'तुम्ही काहीतरी चुकल्याचे सांगितले. आम्ही पाहत आहोत.',
    replyHeading: 'व्यवसायाचे उत्तर',
    lensHeading: 'तुमच्या खात्यांसाठी जाणून घ्या',
    notFound: 'ही लिंक वैध नाही किंवा मुदत संपली आहे. कृपया व्यवसायाकडून नवीन लिंक मागा.',
    loading: 'लोड होत आहे…',
    error: 'काहीतरी चुकले. कृपया पुन्हा प्रयत्न करा.',
    tooMany: 'खूप प्रयत्न झाले. कृपया काही मिनिटे थांबून पुन्हा प्रयत्न करा.',
    contact: 'संपर्क',
  },
};
