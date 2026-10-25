export type Status = 'Real' | 'Simulated' | 'Not connected' | 'Manual' | 'Partly real';
export const REAL_VS_SIMULATED: { what: string; status: Status; note: string }[] = [
  {
    what: 'Online payment (Razorpay)',
    status: 'Not connected',
    note: 'Razorpay is not configured, so the pay page says online payment is not set up. The payment path is tested with signed sample events. The UPI link and QR on the pay page are real.',
  },
  {
    what: 'WhatsApp reminders',
    status: 'Manual',
    note: 'The app opens a WhatsApp chat with the message ready; the owner taps send. Nothing is sent to WhatsApp automatically.',
  },
  {
    what: 'Email reminders',
    status: 'Partly real',
    note: 'Email is really sent. While test mode is on, every email goes to the owner, not to customers.',
  },
  {
    what: 'Bank feed (Account Aggregator)',
    status: 'Not connected',
    note: 'There is no live bank connection. Bank statements are imported from a CSV file and every match is confirmed by a person.',
  },
  {
    what: 'GST IMS (invoice management)',
    status: 'Manual',
    note: 'IMS actions are recorded by hand. Receivia does not connect to the GST portal.',
  },
  {
    what: 'e-invoice (IRN)',
    status: 'Not connected',
    note: 'No IRN is generated. A note appears on invoices when turnover is above ₹5 crore.',
  },
  {
    what: 'AI message wording',
    status: 'Partly real',
    note: 'Wording comes from fixed templates unless an AI key with credit is set. The AI only writes wording; amounts, dates and names are filled in by the app.',
  },
  {
    what: 'Cash forecast',
    status: 'Simulated',
    note: 'A fixed-seed simulation of 2000 runs from your own payment history. It is an estimate with a range, not a promise.',
  },
  {
    what: 'The live demo business',
    status: 'Simulated',
    note: 'Demo Traders and its customers, invoices and bank lines are sample data.',
  },
];

export const SECURITY = [
  'Every table uses row-level security: a signed-in person can only read or change their own business, and tests try cross-business access on every table.',
  'Roles are enforced in the database: the owner can do everything, an accountant can read and write data, a CA can only read.',
  'Secret keys stay on the server and never reach the browser. The AI is called only from server functions and is not sent phone numbers or email addresses.',
  'Pay links are random tokens stored only as SHA-256 hashes, they expire, and each opens one invoice only. Buyer actions are rate-limited.',
  'Every change is written to an append-only audit log by database triggers. Only when a business deletes itself is the personal data inside its log entries removed.',
];
