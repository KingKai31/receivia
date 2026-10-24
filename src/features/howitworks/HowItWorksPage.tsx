import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { GlassCard, Title } from '@/components/ui';
import { REAL_VS_SIMULATED, SECURITY } from '@/features/trust/realVsSim';
import { calcInvoice } from '@/lib/gst';
import { explainChaseScore, explainPayability, explainInvoiceTotal } from '@/lib/explain';
import {
  FORECAST_CONFIG,
  selectActions,
  totals,
  type Candidate,
  type ChaseItem,
  type CustomerDelay,
} from '@/lib/forecast';
import {
  itc180,
  msmeDueDate,
  msmeForm1,
  msmedInterest,
  sec43bh,
  section34Warning,
  LEGAL_CONFIG,
} from '@/lib/legal';
import { formatINR, formatINRShort, paise } from '@/lib/money';
import testsJson from '@/generated/tests.json';
import { DISCLAIMER, LAWS, SITES, TOC } from './content';
import './howitworks.css';

const T = testsJson as {
  generatedAt?: string;
  unit?: { passed: number; failed: number; total: number; files: number };
  dbLocal?: { passed: number; failed: number };
  dbRemote?: { passed: number; note: string };
  e2e?: { total: number; files: number };
  backtest?: { wape: number | null; weeks: number; asOf: string; today: string };
  demoBand?: {
    runs: number;
    bufferPaise: number;
    weeks: { week: number; p10: number; p50: number; p90: number }[];
  };
};

const money = (n: number) => formatINR(paise(Math.round(n)));

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <GlassCard as="section" variant="solid" id={id} className="hw-sec" aria-labelledby={`${id}-h`}>
      <Title>{title}</Title>
      <span id={`${id}-h`} className="sr-only">
        {title}
      </span>
      {children}
    </GlassCard>
  );
}

function Formula({ children }: { children: ReactNode }) {
  return <p className="hw-formula num">{children}</p>;
}

function GstDiagram() {
  return (
    <svg
      className="hw-svg"
      viewBox="0 0 640 210"
      role="img"
      aria-label="Each line is taxed on its own. If the supplier and the place of supply have the same state code, CGST and SGST are each half the rate; otherwise IGST is the full rate."
    >
      <rect className="box" x="10" y="75" width="150" height="60" rx="14" />
      <text x="85" y="102" textAnchor="middle">
        Line taxable value
      </text>
      <text x="85" y="120" textAnchor="middle" className="muted">
        qty × rate − discount
      </text>
      <rect className="box" x="230" y="75" width="170" height="60" rx="14" />
      <text x="315" y="102" textAnchor="middle">
        Same state code?
      </text>
      <text x="315" y="120" textAnchor="middle" className="muted">
        first 2 digits of GSTIN
      </text>
      <path className="link" d="M160 105 H230" />
      <path className="link" d="M400 95 C440 95 440 40 480 40" />
      <path className="link link-peach" d="M400 115 C440 115 440 170 480 170" />
      <rect className="box" x="480" y="12" width="150" height="56" rx="14" />
      <text x="555" y="36" textAnchor="middle">
        Yes: CGST + SGST
      </text>
      <text x="555" y="54" textAnchor="middle" className="muted">
        half the rate each
      </text>
      <rect className="box-peach" x="480" y="142" width="150" height="56" rx="14" />
      <text x="555" y="166" textAnchor="middle">
        No: IGST
      </text>
      <text x="555" y="184" textAnchor="middle" className="muted">
        the full rate
      </text>
    </svg>
  );
}

function GstSection() {
  const lines = [{ qty: 1, rate: paise(1_000_000), gstRate: 18 }];
  const same = calcInvoice({
    lines,
    supplierStateCode: '27',
    placeOfSupply: '27',
    registrationType: 'regular',
  });
  const other = calcInvoice({
    lines,
    supplierStateCode: '27',
    placeOfSupply: '29',
    registrationType: 'regular',
  });
  const ex = explainInvoiceTotal({
    lines,
    supplierStateCode: '27',
    placeOfSupply: '27',
    registrationType: 'regular',
  });
  return (
    <Section id="gst" title="GST engine">
      <p className="hw-lead">
        Money is whole paise everywhere. Each line is taxed on its own and the tax is rounded to the
        paisa; the invoice then adds the lines and rounds the total to the nearest rupee.
      </p>
      <GstDiagram />
      <ol>
        <li>
          <strong>Per-line rounding.</strong> Taxable = quantity × rate − discount. Tax = taxable ×
          rate, rounded half-up to the paisa on every line.
        </li>
        <li>
          <strong>State code.</strong> The state is the first two digits of the GSTIN. Same state:
          CGST and SGST each take half the rate and are rounded separately, so together they can
          differ from IGST by one paisa. Other state: IGST at the full rate.
        </li>
        <li>
          <strong>Round-off.</strong> The subtotal is rounded to the nearest rupee and the
          difference is shown as its own line.
        </li>
      </ol>
      <h3>Worked example: ₹10,000 at 18%</h3>
      <table className="hw-table num">
        <caption className="sr-only">GST worked example, same state and other state</caption>
        <thead>
          <tr>
            <th scope="col">Line</th>
            <th scope="col" className="n">
              Same state (27 to 27)
            </th>
            <th scope="col" className="n">
              Other state (27 to 29)
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Taxable value</td>
            <td className="n">{formatINR(same.taxable)}</td>
            <td className="n">{formatINR(other.taxable)}</td>
          </tr>
          <tr>
            <td>CGST 9%</td>
            <td className="n">{formatINR(same.cgst)}</td>
            <td className="n">–</td>
          </tr>
          <tr>
            <td>SGST 9%</td>
            <td className="n">{formatINR(same.sgst)}</td>
            <td className="n">–</td>
          </tr>
          <tr>
            <td>IGST 18%</td>
            <td className="n">–</td>
            <td className="n">{formatINR(other.igst)}</td>
          </tr>
          <tr>
            <td>Round-off</td>
            <td className="n">{formatINR(same.roundOff)}</td>
            <td className="n">{formatINR(other.roundOff)}</td>
          </tr>
          <tr>
            <th scope="row">Total</th>
            <th scope="row" className="n">
              {formatINR(same.grandTotal)}
            </th>
            <th scope="row" className="n">
              {formatINR(other.grandTotal)}
            </th>
          </tr>
        </tbody>
      </table>
      <p className="muted">
        These two columns are computed by the same code that issues invoices. {ex.law}
      </p>
      <h3>Which document and which wording</h3>
      <ul>
        <li>
          Regular supplier: <strong>Tax Invoice</strong> (CGST Rules, Rule 46 lists its contents).
        </li>
        <li>
          Composition supplier: <strong>Bill of Supply</strong> headed “Composition taxable person,
          not eligible to collect tax on supplies”, with no tax charged (Rule 49).
        </li>
        <li>Unregistered supplier: a plain invoice with no GST.</li>
        <li>A note about e-invoicing appears when turnover is above ₹5 crore.</li>
      </ul>
      <p className="muted">
        Rate table in config: 0, 0.25, 3, 5, 18 and 40%. Verify rates and rules on{' '}
        <a href={SITES.cbic.href} rel="noopener noreferrer">
          {SITES.cbic.label}
        </a>{' '}
        (CGST Act s.9 and s.15, IGST Act s.5, Rules 46 and 49). {DISCLAIMER}
      </p>
    </Section>
  );
}

function ItcBar() {
  return (
    <div aria-hidden="true">
      <div className="hw-bar">
        <span style={{ ['--w' as string]: '100%' }} />
      </div>
      <div className="muted" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>Invoice date</span>
        <span>+180 days</span>
      </div>
    </div>
  );
}

function LawsSection() {
  const today = '2026-10-26';
  const sample = useMemo(() => {
    const buyer = {
      gstin: '27AAPFU0939F1ZV',
      entity_type: 'company' as const,
      presumptive_tax: 'no' as const,
      credit_days: 30,
      has_written_agreement: true,
    };
    const seller = {
      udyam_number: 'UDYAM-MH-00-0000000',
      enterprise_size: 'micro' as const,
      activity: 'manufacturing' as const,
    };
    const due = msmeDueDate('2026-08-01', 30, true);
    const inv = {
      invoice_type: 'tax_invoice' as const,
      issue_date: '2026-04-20',
      total_paise: 11_800_000,
      paid_paise: 0,
      cgst_paise: 0,
      sgst_paise: 0,
      igst_paise: 1_800_000,
      reverse_charge: false,
    };
    const i = msmedInterest({ principal: paise(11_800_000), dueDate: due, asOf: today });
    return {
      itc180: itc180(inv, buyer, today).sentence_en,
      '43bh': sec43bh({ seller, buyer, msmeDue: due, today }).sentence_en,
      interest: `At ${i.annual_rate_pct}% a year on ${money(11_800_000)} for ${i.days} days: ${money(i.interest_paise)}.`,
      form1: msmeForm1({ buyer, msmeDue: due, today }).sentence_en,
      s34: section34Warning('2026-04-20', today).text,
      tds: 'A ₹1,18,000.00 invoice (taxable value ₹1,00,000.00) is paid ₹2,000.00 short by a government buyer: that matches GST TDS at 2% of the taxable value within ₹1, so it is proposed as TDS and a person confirms it.',
    } as Record<string, string>;
  }, []);
  return (
    <Section id="laws" title="Laws we apply">
      <p className="hw-lead">
        Receivia quotes a rule only when it may apply to that buyer and that invoice. Lines about
        the buyer’s side are hedged (“may”, “generally”), name the section, and end with the
        sentence below. Example facts: ₹1,18,000 invoice dated 20 April 2026, a company buyer, a
        micro manufacturer, checked on {today}.
      </p>
      <p>
        <strong>{DISCLAIMER}</strong> Links go to the official sites; find the section there and
        verify before relying on it.
      </p>
      <div className="hw-grid">
        {LAWS.map((l) => (
          <article key={l.id} className="hw-card" id={`law-${l.id}`}>
            <h3>{l.name}</h3>
            {l.id === 'itc180' ? <ItcBar /> : null}
            <p>
              <strong>May apply when:</strong> {l.eligibility}
            </p>
            <p>{l.summary}</p>
            <p>
              <strong>Our wording:</strong>
            </p>
            <blockquote style={{ margin: 0 }}>{sample[l.id]}</blockquote>
            <p className="muted">Shown in: {l.where}</p>
            <p>
              {l.links.map((k) => (
                <span key={k.href}>
                  <a href={k.href} rel="noopener noreferrer">
                    {k.label}
                  </a>{' '}
                </span>
              ))}
            </p>
          </article>
        ))}
      </div>
      <h3>TDS rates in config</h3>
      <p className="muted">
        194C 2% (company, firm) or 1% (individual, proprietor); 194J 10% professional, 2% technical;
        194H 2%; 194Q 0.1%; GST TDS 2% (government buyers). RBI bank rate placeholder{' '}
        {LEGAL_CONFIG.rbiBankRatePct}%, three times that for MSMED interest. Verify all rates.
      </p>
    </Section>
  );
}

function BandSvg() {
  const d = T.demoBand;
  if (!d) return null;
  const W = 620;
  const H = 200;
  const pad = 8;
  const lo = Math.min(...d.weeks.map((w) => w.p10), d.bufferPaise);
  const hi = Math.max(...d.weeks.map((w) => w.p90), d.bufferPaise);
  const x = (i: number) => pad + (i * (W - 2 * pad)) / (d.weeks.length - 1);
  const y = (v: number) => H - pad - ((v - lo) * (H - 2 * pad)) / (hi - lo || 1);
  const up = d.weeks.map((w, i) => `${x(i)},${y(w.p90)}`).join(' L');
  const down = [...d.weeks]
    .reverse()
    .map((w, i) => `${x(d.weeks.length - 1 - i)},${y(w.p10)}`)
    .join(' L');
  const mid = d.weeks.map((w, i) => `${i ? 'L' : 'M'}${x(i)},${y(w.p50)}`).join(' ');
  return (
    <svg
      className="hw-svg"
      viewBox={`0 0 ${W} ${H + 24}`}
      role="img"
      aria-label="Demo business forecast, 13 weeks: the shaded band is P10 to P90 of the closing balance, the line is P50, the dashed line is the safety buffer."
    >
      <path className="band90" d={`M${up} L${down} Z`} />
      <path className="band50" d={mid} />
      <line className="buffer" x1={pad} x2={W - pad} y1={y(d.bufferPaise)} y2={y(d.bufferPaise)} />
      <text x={W - pad} y={y(d.bufferPaise) - 4} textAnchor="end" className="muted">
        safety buffer {formatINRShort(paise(d.bufferPaise))}
      </text>
      <text x={pad} y={H + 16} className="muted">
        week 1
      </text>
      <text x={W - pad} y={H + 16} textAnchor="end" className="muted">
        week 13
      </text>
    </svg>
  );
}

function ShrinkBars() {
  const k = FORECAST_CONFIG.shrinkK;
  const ns = [0, 1, 2, 4, 8, 16];
  return (
    <svg
      className="hw-svg"
      viewBox="0 0 400 130"
      role="img"
      aria-label={`Weight on a customer’s own history n/(n+${k}) for n = ${ns.join(', ')}`}
    >
      {ns.map((n, i) => {
        const w = n / (n + k);
        const h = 80 * w;
        return (
          <g key={n}>
            <rect
              className="bar"
              x={20 + i * 62}
              y={100 - h}
              width="38"
              height={Math.max(h, 1)}
              rx="6"
            />
            <text x={39 + i * 62} y="118" textAnchor="middle" className="muted">
              n={n}
            </text>
            <text x={39 + i * 62} y={94 - h} textAnchor="middle">
              {Math.round(w * 100)}%
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function ForecastSection() {
  const wape = T.backtest?.wape;
  return (
    <Section id="forecast" title="Forecast">
      <p className="hw-lead">
        The forecast is an estimate with a range, not a promise. It learns how late each customer
        usually pays, then plays the next 13 weeks forward many times.
      </p>
      <h3>Delay model with shrinkage</h3>
      <p>
        For each customer we measure how many days after the due date their paid invoices were
        settled. A customer with few invoices is pulled toward everyone’s average:
      </p>
      <Formula>
        weight w = n / (n + k), with k = {FORECAST_CONFIG.shrinkK} and n = paid invoices
        <br />
        delay used = w × own history + (1 − w) × overall history
      </Formula>
      <ShrinkBars />
      <p className="muted">
        With no history at all the model starts from a prior of{' '}
        {FORECAST_CONFIG.priorDelays.join(', ')} days late. Fewer than{' '}
        {FORECAST_CONFIG.lowConfidenceBelow} paid invoices is flagged low confidence. Grade A:
        shrunk P80 up to {FORECAST_CONFIG.gradeA_p80} days late, B up to{' '}
        {FORECAST_CONFIG.gradeB_p80}, else C.
      </p>
      <h3>Monte Carlo, {FORECAST_CONFIG.runs} runs</h3>
      <p>
        Each run draws a payment date for every open invoice from its customer’s delay history
        (given it has not arrived yet), adds the known bills on their dates, and records each week’s
        closing balance. P10, P50 and P90 are the values 10%, 50% and 90% of the runs fell at or
        below. The seed is fixed, so the same data always gives the same forecast.
      </p>
      <BandSvg />
      <p className="muted">
        The demo business above: {T.demoBand?.runs ?? FORECAST_CONFIG.runs} runs, shaded P10 to P90,
        line P50. Simulated data.
      </p>
      <h3>Backtest on the demo data</h3>
      <p>
        We hide the last {T.backtest?.weeks ?? FORECAST_CONFIG.backtestWeeks} weeks, forecast them
        from what was known then, and compare with what was actually collected.
      </p>
      <Formula>WAPE = sum |actual − forecast| ÷ sum actual (lower is better)</Formula>
      <p>
        Live number from the build of {T.backtest?.today ?? 'this build'}:{' '}
        <strong className="hw-live num">
          {wape === null || wape === undefined ? 'not available' : `${Math.round(wape * 100)}%`}
        </strong>{' '}
        weekly WAPE on the demo story. Weekly collections are lumpy, so this is a rough guide; the
        point of the P10 to P90 range is to show that.
      </p>
    </Section>
  );
}

const CHASE_EX: ChaseItem = {
  invoiceId: 'example',
  customerId: 'example',
  customerName: 'Example Traders',
  balancePaise: 10_000_000,
  daysOverdue: 30,
  expectedPaise: 7_000_000,
  probBase: 0.35,
  probChased: 0.7,
  score: 7_000_000 * 1.25 * 0.85,
  targetWeek: 3,
  reason: '',
};
const CAND: Candidate[] = [
  {
    id: 'c1',
    group: 'inv1',
    kind: 'chase',
    cover: 6_000_000,
    cost: 0,
    sentence: 'Chase invoice 1 (free)',
  },
  {
    id: 'c2',
    group: 'inv2',
    kind: 'discount',
    cover: 5_000_000,
    cost: 100_000,
    sentence: 'Offer invoice 2 an early-payment discount',
  },
  {
    id: 'c3',
    group: 'bill1',
    kind: 'defer',
    cover: 3_000_000,
    cost: 22_500,
    sentence: 'Defer the packaging bill by 15 days',
  },
  {
    id: 'c4',
    group: 'inv3',
    kind: 'treds',
    cover: 9_000_000,
    cost: 450_000,
    sentence: 'Sell invoice 3 on TReDS',
  },
];

function ChaseSection() {
  const ex = explainChaseScore(CHASE_EX, 'B');
  const gap = 10_000_000;
  const picked = selectActions(CAND, gap);
  const t = totals(picked);
  const delay = {
    n: 8,
    weight: 8 / 13,
    p80: 24,
    grade: 'B',
  } as CustomerDelay;
  const pay = explainPayability(delay);
  return (
    <Section id="chase" title="Chase score and gap solver">
      <h3>Chase score</h3>
      <Formula>
        score = (balance × chance paid in time if chased) × (1 + days overdue ÷ 120) × reliability
        weight
        <br />
        weights: A 1, B 0.85, C 0.65; days overdue capped at 120; disputed invoices score 0
      </Formula>
      <p>
        Worked example: ₹1,00,000 balance, 70% chance of arriving by the end of week 3 if chased, 30
        days overdue, grade B. Expected = {money(CHASE_EX.expectedPaise)}; × 1.25 × 0.85 ={' '}
        <strong className="num">{Math.round(Number(ex.value))}</strong> (a ranking number, not
        rupees). The Collect page orders customers by their best score.
      </p>
      <h3>Payability score</h3>
      <Formula>score = 100 − (shrunk P80 days late × 100 ÷ 60), kept between 0 and 100</Formula>
      <p>
        Example: 8 paid invoices (weight {Math.round(delay.weight * 100)}% on own history), P80 of
        24 days late gives <strong className="num">{pay.display}</strong>.
      </p>
      <h3>Gap solver</h3>
      <p>
        When a week is expected to close below your safety buffer, the solver picks the cheapest set
        of actions that cover the gap, at most one per invoice or bill: chase (free), an
        early-payment discount ({FORECAST_CONFIG.earlyDiscountPct}% of the cash it brings), TReDS (
        {FORECAST_CONFIG.tredsAnnualRatePct}% a year for the days sped up; company and government
        buyers only), or deferring a deferrable bill ({FORECAST_CONFIG.deferFeePctPerMonth}% a
        month). It takes actions by cost per rupee covered, then drops any paid step that is no
        longer needed. Rates are assumptions to check with your bank.
      </p>
      <table className="hw-table num">
        <caption>Worked example: a gap of {money(gap)}</caption>
        <thead>
          <tr>
            <th scope="col">Candidate</th>
            <th scope="col" className="n">
              Covers
            </th>
            <th scope="col" className="n">
              Costs
            </th>
            <th scope="col">Chosen</th>
          </tr>
        </thead>
        <tbody>
          {CAND.map((c) => (
            <tr key={c.id}>
              <td>{c.sentence}</td>
              <td className="n">{money(c.cover)}</td>
              <td className="n">{money(c.cost)}</td>
              <td>{picked.includes(c) ? 'Yes' : 'No'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Plan: covers {money(t.cover)} for <strong className="num">{money(t.cost)}</strong>. The
        TReDS step is the most expensive per rupee, so it is left out.
      </p>
    </Section>
  );
}

const STEPS: [string, string][] = [
  ['Plan', 'rules pick who to chase'],
  ['Draft', 'wording only'],
  ['Check', 'validator'],
  ['Approve', 'owner or autonomy rule'],
  ['Send', 'revalidated live'],
  ['Log', 'append-only'],
];
const GUARDRAILS = [
  'Numbers come from the database only. The AI never sees or writes an amount, date, name or link: it returns wording with slots, and the app fills the slots at send time.',
  'A validator rejects any draft with digits (including Devanagari), number words, a rupee sign, links, unknown or missing slots, banned words or a bad length. A rejected draft falls back to the fixed template.',
  'Banned words include legal-sounding threats. Demand letters never go through the model.',
  'Nothing leaves without approval: autonomy level 0 only suggests; level 1 auto-approves friendly and reminder stages for standard-tier customers; key customers always need the owner.',
  'Every plan, approval and send is written to the append-only audit log by database triggers.',
  'Prompt-injection isolation: customer text (such as a dispute reason) is placed only inside delimited data markers, the closing marker is stripped, the model has no tools, and a test shows injected text cannot change an amount.',
];

function AgentSection() {
  return (
    <Section id="agent" title="Agent workflow">
      <p className="hw-lead">
        The agent proposes; people and rules decide. One run goes through six steps, and each is
        checked before the next.
      </p>
      <ol className="hw-steps" aria-label="Agent pipeline: Plan, Draft, Check, Approve, Send, Log">
        {STEPS.map(([a, b]) => (
          <li key={a}>
            {a}
            <small>{b}</small>
          </li>
        ))}
      </ol>
      <h3>Guardrails</h3>
      <ul>
        {GUARDRAILS.map((g) => (
          <li key={g}>{g}</li>
        ))}
      </ul>
    </Section>
  );
}

function SecuritySection() {
  const rows: [string, string][] = [
    [
      'Unit and property tests',
      T.unit
        ? `${T.unit.passed} of ${T.unit.total} pass, ${T.unit.files} test suites`
        : 'not available',
    ],
    [
      'Database tests, in-process Postgres (PGlite)',
      T.dbLocal
        ? `${T.dbLocal.passed} pass (the cross-business isolation suite needs a real database)`
        : 'not available',
    ],
    [
      'Database tests, real Postgres',
      T.dbRemote ? `${T.dbRemote.passed} pass, ${T.dbRemote.note}` : 'not available',
    ],
    [
      'Browser tests (Playwright)',
      T.e2e ? `${T.e2e.total} tests in ${T.e2e.files} files` : 'not available',
    ],
  ];
  return (
    <Section id="security" title="Security">
      <ul>
        {SECURITY.map((s) => (
          <li key={s}>{s}</li>
        ))}
        <li>
          Privacy (DPDP): a notice, consent recorded per customer and channel, export of your data,
          and erasure of a business with a typed confirmation. See the{' '}
          <Link to="/privacy">privacy notice</Link>.
        </li>
      </ul>
      <h3>Live test counts</h3>
      <table className="hw-table num">
        <caption className="sr-only">Test counts from the last build</caption>
        <tbody>
          {rows.map(([a, b]) => (
            <tr key={a}>
              <th scope="row">{a}</th>
              <td>{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">
        Counted by <code>scripts/gen-tests-json.mjs</code> when the site is built
        {T.generatedAt ? ` (${T.generatedAt.slice(0, 10)})` : ''}. You can also run checks in your
        own browser on the <Link to="/trust">Trust page</Link>.
      </p>
    </Section>
  );
}

function RealSection() {
  return (
    <Section id="real" title="Real vs simulated">
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {REAL_VS_SIMULATED.map((x) => (
          <li key={x.what}>
            <strong>{x.what}</strong> ({x.status}) <br />
            {x.note}
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function HowItWorksPage() {
  return (
    <main id="main" className="app-main hw">
      <div className="app-top">
        <Link className="brand" to="/sign-in">
          Receivia
        </Link>
      </div>
      <h1>How Receivia works</h1>
      <p className="hw-lead">
        Every number in the app comes from a rule you can read here. Each computed figure also has a
        “?” button that opens the formula, the values it used, the rows behind it and the law, if
        any. {DISCLAIMER}
      </p>
      <nav aria-label="On this page">
        <ul className="hw-toc">
          {TOC.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`}>{label}</a>
            </li>
          ))}
        </ul>
      </nav>
      <GstSection />
      <LawsSection />
      <ForecastSection />
      <ChaseSection />
      <AgentSection />
      <SecuritySection />
      <RealSection />
      <p>
        <Link to="/trust">Trust checks</Link> · <Link to="/privacy">Privacy notice</Link> ·{' '}
        <Link to="/sign-in">Sign in</Link>
      </p>
    </main>
  );
}
