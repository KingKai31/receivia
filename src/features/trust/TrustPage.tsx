import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, Gauge, LanguagePicker, ResponsiveTable } from '@/components/ui';
import { REAL_VS_SIMULATED, SECURITY } from './realVsSim';
import { runTrustCasesGradually, TRUST_CASE_COUNT, type TrustCase } from './trustCases';

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
    <main id="main" className="app-main flex flex-col gap-4" style={{ maxWidth: 840 }}>
      <div className="app-top">
        <span className="brand">{t('brand')}</span>
        <LanguagePicker />
      </div>
      <h1>{t('pages.trust')}</h1>
      <p>
        {t(
          'You do not have to take our word for it. These checks run on your own device, right now, using the same code the app uses for invoices, reminders, matching and the forecast.',
        )}
      </p>
      <Gauge
        percent={results && results.length > 0 ? (passed / results.length) * 100 : 0}
        label={t('Checks running in your browser')}
      />
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
        <Link to="/how-it-works">{t('How it works')}</Link> {t('·')}{' '}
        <Link to="/privacy">{t('Privacy notice')}</Link> {t('·')}{' '}
        <Link to="/">{t('Open the app')}</Link>
      </p>
    </main>
  );
}
