// The demo story as pure data: Shree Ganesh Corrugators (Pune), 12 customers, ~45 invoices over 6 months,
// recurring expenses and the cash settings. Every date is an offset in days from the demo date, so the story is the
// same whenever it is seeded. All names, GSTINs, phones and bank details are made up.
// Used by scripts/seed-demo.mjs and src/lib/forecast/demo.test.ts.

export const DEMO_ORG = '00000000-0000-4000-8000-00000000de60';
export const BUFFER_PAISE = 20000000; // ₹2,00,000
export const TARGET_GAP_PAISE = 13000000; // week 3 closes about ₹1,30,000 under the buffer

export const addDays = (iso, n) =>
  new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);
export const istToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
export const fyOf = (iso) => {
  const y = Number(iso.slice(0, 4));
  const s = Number(iso.slice(5, 7)) >= 4 ? y : y - 1;
  return `${String(s).slice(2)}-${String(s + 1).slice(2)}`;
};

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** Builds a GSTIN with a correct check character (standard mod-36 scheme). */
export function gstin(state, pan) {
  const body = `${state}${pan}1Z`;
  let sum = 0;
  [...body].forEach((ch, i) => {
    const p = CHARS.indexOf(ch) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  });
  return body + CHARS[(36 - (sum % 36)) % 36];
}

export const PROFILE = {
  legal_name: 'Shree Ganesh Corrugators',
  registration_type: 'regular',
  gstin: gstin('27', 'AAJFS4821K'),
  state_code: '27',
  udyam_number: 'UDYAM-MH-26-0048213',
  enterprise_size: 'micro',
  activity: 'manufacturing',
  annual_turnover_paise: 32000000000, // ₹3.2 crore, under the ₹5 crore e-invoice line
  address: 'Plot 14, Bhosari MIDC, Pune, Maharashtra 411026',
  phone: '9822000100',
  email: 'accounts@shreeganesh-corrugators.example.test',
  bank_name: 'Sahyadri Co-operative Bank',
  bank_account_holder: 'Shree Ganesh Corrugators',
  bank_account_number: '60100000412',
  bank_ifsc: 'HDFC0000001',
  upi_id: 'shreeganesh@upi',
  employees: 8,
};

// key, name, state, entity, tier, language, pan (fictional), phone, credit days 30
export const CUSTOMERS = [
  ['mithai', 'Mithai Sweets', '24', 'company', 'key', 'en', 'AABCM3140D', '9879000011'],
  ['pune', 'Pune Distributors', '27', 'firm', 'standard', 'en', 'AAEFP7712C', '9822000012'],
  ['hospital', 'City Hospital', '27', 'government', 'standard', 'en', 'AAAGC0021H', '9822000013'],
  [
    'bharat',
    'Bharat Auto Components Ltd',
    '27',
    'company',
    'standard',
    'en',
    'AABCB9054J',
    '9822000014',
  ],
  ['sai', 'Sai Stationery Mart', '27', 'proprietor', 'standard', 'en', null, '9822000015'],
  [
    'pharma',
    'Sanjivani Pharma Packers Pvt Ltd',
    '27',
    'company',
    'standard',
    'en',
    'AACCS2210M',
    '9822000016',
  ],
  ['raj', 'Raj Plastics', '27', 'firm', 'standard', 'hi', 'AAFFR5033Q', '9822000017'],
  ['kolhapur', 'Kolhapur Foods', '27', 'firm', 'standard', 'mr', 'AAFFK6178B', '9822000018'],
  ['nashik', 'Nashik Agro Pack', '27', 'proprietor', 'standard', 'en', 'AAKPN4402E', '9822000019'],
  ['aurang', 'Aurangabad Auto Parts', '27', 'firm', 'standard', 'en', 'AAEFA8821L', '9822000020'],
  ['surat', 'Surat Textile Traders', '24', 'firm', 'standard', 'en', 'AAFFS3390R', '9879000021'],
  ['mumbai', 'Mumbai Logistics LLP', '27', 'firm', 'standard', 'en', 'AAMFM1175N', '9822000022'],
  [
    'pmh',
    'Pune Municipal Hospital',
    '27',
    'government',
    'standard',
    'en',
    'AAALP0482G',
    '9822000023',
  ],
].map(([key, name, state, entity_type, tier, language, pan, phone]) => ({
  key,
  name,
  state_code: state,
  entity_type,
  tier,
  language,
  gstin: pan ? gstin(state, pan) : null,
  phone,
  email: `${key}@example.test`,
  is_psu: key === 'pmh',
}));

// customer, issue offset, taxable rupees, days paid after the due date (null = still open). Credit is 30 days.
const ROWS = [
  ['mithai', -170, 90000, 6],
  ['mithai', -135, 120000, 9],
  ['mithai', -100, 80000, 8],
  ['mithai', -68, 100000, null],
  ['mithai', -5, 110000, null],
  ['pune', -165, 140000, 22],
  ['pune', -130, 160000, 25],
  ['pune', -95, 150000, 28],
  ['pune', -42, 130000, null],
  ['pune', -20, 160000, null],
  ['hospital', -200, 290000, 52],
  ['hospital', -160, 300000, 48],
  ['hospital', -110, 280000, 50],
  ['hospital', -50, 320000, null],
  ['bharat', -150, 350000, 14],
  ['bharat', -115, 400000, 16],
  ['bharat', -80, 380000, 15],
  ['bharat', -36, 200000, null],
  ['bharat', -12, 420000, null],
  ['sai', -140, 18000, 18],
  ['sai', -100, 20000, 20],
  ['sai', -55, 20000, null],
  ['pharma', -172, 250000, 1],
  ['pharma', -140, 260000, 0],
  ['pharma', -105, 240000, 2],
  ['pharma', -70, 270000, 1],
  ['pharma', -22, 290000, null],
  ['raj', -155, 100000, 9],
  ['raj', -110, 110000, 10],
  ['raj', -38, 100000, null],
  ['kolhapur', -130, 80000, 11],
  ['kolhapur', -90, 85000, 13],
  ['kolhapur', -34, 90000, null],
  ['nashik', -145, 70000, 12],
  ['nashik', -100, 72000, 14],
  ['nashik', -27, 75000, null],
  ['aurang', -120, 150000, 7],
  ['aurang', -85, 160000, 6],
  ['aurang', -40, 140000, null],
  ['aurang', -8, 170000, null],
  ['surat', -125, 130000, 16],
  ['surat', -75, 135000, 17],
  ['surat', -32, 125000, null],
  ['mumbai', -100, 200000, 5],
  ['mumbai', -60, 210000, 4],
  ['mumbai', -10, 220000, null],
];

export function buildInvoices(today) {
  const state = Object.fromEntries(CUSTOMERS.map((c) => [c.key, c.state_code]));
  const sorted = ROWS.map((r, i) => ({ r, i })).sort((a, b) => a.r[1] - b.r[1] || a.i - b.i);
  // Government buyer: one invoice overdue 32 days, numbered after the others so existing numbers do not move.
  const all = [...sorted.map(({ r }) => r), ['pmh', -62, 240000, null]];
  return all.map(([customer, issueOff, rupees, delay], k) => {
    const taxable = rupees * 100;
    const igst = state[customer] !== '27';
    const half = Math.round((taxable * 9) / 100);
    const tax = igst ? { cgst: 0, sgst: 0, igst: half * 2 } : { cgst: half, sgst: half, igst: 0 };
    const issue = addDays(today, issueOff);
    const due = addDays(issue, 30);
    return {
      number: `INV/${fyOf(issue)}/${String(k + 1).padStart(4, '0')}`,
      customer,
      place: state[customer],
      issue_off: issueOff,
      issue,
      due,
      due_off: issueOff + 30,
      taxable_paise: taxable,
      ...tax,
      total_paise: taxable + tax.cgst + tax.sgst + tax.igst,
      paid_off: delay === null ? null : issueOff + 30 + delay,
    };
  });
}

/** Open invoices keyed for the story beats. */
export function beats(invoices) {
  const open = (c, dueOff) =>
    invoices.find((i) => i.customer === c && i.paid_off === null && i.due_off === dueOff);
  return {
    mithaiOverdue: open('mithai', -38),
    puneOverdue: open('pune', -12),
    saiClaim: open('sai', -25),
    rajHindi: open('raj', -8),
    aurangDispute: open('aurang', -10),
  };
}

export const EXPENSES = [
  {
    name: 'Salaries',
    kind: 'salary',
    amount_paise: 24000000,
    recurrence: 'monthly',
    day: 1,
    can_defer: false,
  },
  {
    name: 'Godown and office rent',
    kind: 'rent',
    amount_paise: 11000000,
    recurrence: 'monthly',
    day: 5,
    can_defer: false,
  },
  {
    name: 'Electricity',
    kind: 'utility',
    amount_paise: 3200000,
    recurrence: 'monthly',
    day: 12,
    can_defer: false,
  },
  {
    name: 'GST payment',
    kind: 'tax',
    amount_paise: 9500000,
    recurrence: 'monthly',
    day: 20,
    can_defer: false,
  },
  {
    name: 'Insurance premium',
    kind: 'other',
    amount_paise: 6000000,
    recurrence: 'quarterly',
    due_off: 45,
    can_defer: false,
  },
  {
    name: 'Kraft paper mill bill',
    kind: 'supplier',
    amount_paise: 80000000,
    recurrence: null,
    due_off: 9,
    can_defer: false,
  },
  {
    name: 'Machinery loan instalment',
    kind: 'other',
    amount_paise: 60000000,
    recurrence: null,
    due_off: 16,
    can_defer: false,
  },
  {
    name: 'Starch and ink supplier bill',
    kind: 'supplier',
    amount_paise: 18000000,
    recurrence: null,
    due_off: 17,
    can_defer: true,
  },
  {
    name: 'Corrugation machine service',
    kind: 'other',
    amount_paise: 30000000,
    recurrence: null,
    due_off: 40,
    can_defer: false,
  },
];

export const nextDayOfMonth = (today, day) => {
  const [y, m, d] = today.split('-').map(Number);
  const t = day >= d ? new Date(Date.UTC(y, m - 1, day)) : new Date(Date.UTC(y, m, day));
  return t.toISOString().slice(0, 10);
};

/** Expense rows as the forecast engine sees them (same shape the app builds from the table). */
export function expenseInputs(today) {
  return EXPENSES.map((e, k) => {
    const first = e.day ? nextDayOfMonth(today, e.day) : addDays(today, e.due_off);
    return {
      id: `e${k}`,
      name: e.name,
      kind: e.kind,
      amountPaise: e.amount_paise,
      expenseDate: first,
      isRecurring: Boolean(e.recurrence),
      recurrence: e.recurrence,
      nextDue: e.recurrence ? first : null,
      endsOn: null,
      active: true,
      deferrable: e.can_defer,
    };
  });
}

/** What the forecast engine takes as input for this story, given its library (lib/forecast bundle). */
export function forecastInput(lib, today, openingBalancePaise = 0) {
  const invoices = buildInvoices(today);
  const customers = CUSTOMERS.map((c) => ({
    id: c.key,
    name: c.name,
    entityType: c.entity_type,
    creditDays: 30,
  }));
  const hist = [];
  const open = [];
  const b = beats(invoices);
  for (const i of invoices) {
    if (i.paid_off !== null) {
      hist.push({
        id: i.number,
        customerId: i.customer,
        issueDate: i.issue,
        dueDate: i.due,
        totalPaise: i.total_paise,
        events: [{ date: addDays(today, i.paid_off), amountPaise: i.total_paise }],
      });
    } else {
      open.push({
        id: i.number,
        number: i.number,
        customerId: i.customer,
        dueDate: i.due,
        balancePaise: i.total_paise,
        // The open dispute and the active promise change the forecast exactly as the app applies them.
        disputed: i === b.aurangDispute,
        promisedFor: i === b.puneOverdue ? addDays(today, 3) : null,
      });
    }
  }
  const models = lib.buildDelayModels(lib.delaySamples(hist));
  const occ = lib.occurrences(expenseInputs(today), today, addDays(today, 90));
  return {
    customers,
    hist,
    open,
    models,
    occ,
    input: {
      today,
      openingBalancePaise,
      bufferPaise: BUFFER_PAISE,
      invoices: open,
      customers,
      models,
      occurrences: occ,
    },
  };
}

/**
 * Opening balance that leaves week 3 closing TARGET_GAP_PAISE under the buffer. The simulation uses a fixed seed and
 * the balance only shifts every week's closing, so one run at zero tells us the shift needed.
 */
export function calibrateOpening(lib, today) {
  const f = lib.simulate(forecastInput(lib, today, 0).input);
  const week3 = f.weeks[2].closing.p50;
  return Math.round((BUFFER_PAISE - TARGET_GAP_PAISE - week3) / 10000) * 10000;
}
