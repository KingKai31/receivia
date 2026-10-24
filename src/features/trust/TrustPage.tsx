import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, LanguagePicker, ResponsiveTable } from '@/components/ui';
import { runTrustCasesGradually, TRUST_CASE_COUNT, type TrustCase } from './trustCases';

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

export function TrustPage() {
  const { t } = useTranslation();
  const [results, setResults] = useState<TrustCase[] | null>(null);
  const run = () => {
    setResults(null);
    void runTrustCasesGradually(setResults);
  };
  useEffect(run, []);
  const passed = results?.filter((r) => r.pass).length ?? 0;
  const finished = results !== null && results.length === TRUST_CASE_COUNT;

  return (
    <main id="main" className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <LanguagePicker />
      <h1>{t('pages.trust')}</h1>
      <p>
        {t(
          'You do not have to take our word for it. These checks run on your own device, right now, using the same code the app uses for invoices, reminders, matching and the forecast.',
        )}
      </p>
      <Card title="Checks running in your browser">
        <p role="status" aria-live="polite">
          {!finished
            ? t('Running…')
            : results.length === passed
              ? t('All {{n}} checks passed.', { n: results.length })
              : t('{{passed}} of {{n}} checks passed. Some did not.', {
                  passed,
                  n: results.length,
                })}
        </p>
        <Button variant="secondary" onClick={run}>
          {t('Run again')}
        </Button>
        <ResponsiveTable<TrustCase>
          caption="Trust checks: expected against actual"
          rows={results ?? []}
          rowKey={(r) => `${r.group}/${r.name}`}
          emptyText="Running…"
          columns={[
            { key: 'group', header: 'Area', render: (r) => t(r.group) },
            { key: 'name', header: 'Case', render: (r) => t(r.name) },
            {
              key: 'exp',
              header: 'Expected',
              render: (r) => <span className="tnum">{r.expected}</span>,
            },
            {
              key: 'act',
              header: 'Actual',
              render: (r) => <span className="tnum">{r.actual}</span>,
            },
            {
              key: 'res',
              header: 'Result',
              render: (r) => <Badge>{r.pass ? 'Pass' : 'FAIL'}</Badge>,
            },
          ]}
        />
      </Card>
      <Card title="What is real and what is simulated">
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {REAL_VS_SIMULATED.map((x) => (
            <li key={x.what}>
              <strong>{t(x.what)}</strong> <Badge>{x.status}</Badge>
              <br />
              {t(x.note)}
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Security model in five lines">
        <ol>
          {SECURITY.map((s) => (
            <li key={s}>{t(s)}</li>
          ))}
        </ol>
      </Card>
      <p>
        <Link to="/privacy">{t('Privacy notice')}</Link> {t('·')}{' '}
        <Link to="/">{t('Open the app')}</Link>
      </p>
    </main>
  );
}
