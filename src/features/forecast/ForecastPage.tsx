import { Freshness } from '@/features/forecast/Freshness';
import { prettyDate } from '@/features/collect/today';
import { tr } from '@/app/i18n';
import { useTranslation } from 'react-i18next';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Card,
  GlassCard,
  HeroCard,
  Input,
  Loading,
  ResponsiveTable,
  Select,
  Title,
} from '@/components/ui';
import {
  backtest,
  describeWhatIf,
  firstShortfall,
  lowestPoint,
  runWhatIf,
  safeWeeks,
  simulate,
  type WhatIf,
} from '@/lib/forecast';
import { formatINR, formatINRShort, paise, parseRupees } from '@/lib/money';
import { errorMessage } from '@/lib/service/errors';
import { Why } from '@/components/ui';
import {
  explainChaseScore,
  explainCreditLimit,
  explainForecastQuantile,
  explainPayability,
  explainShortfall,
  explainSolverCost,
} from '@/lib/explain';
import { modelFor } from '@/lib/forecast';
import { daysBetween } from '@/lib/dates';
import { ActualVsForecastChart, BandChart } from './charts';
import { toInput } from './forecastService';
import { useForecast } from './useForecast';
import './forecast.css';

function rupeesOrZero(v: string): number {
  try {
    return Number(parseRupees(v || '0'));
  } catch {
    return 0;
  }
}

const money = (n: number) => formatINR(paise(Math.round(n)));

function WhatIfCard({ f }: { f: NonNullable<ReturnType<typeof useForecast>['ctx']> }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<WhatIf['kind']>('payLater');
  const [customerId, setCustomerId] = useState('');
  const [days, setDays] = useState('30');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const bills = useMemo(() => {
    const seen = new Map<string, string>();
    for (const o of f.occurrences) seen.set(o.expenseId, o.name);
    return [...seen.entries()];
  }, [f.occurrences]);
  const [billId, setBillId] = useState('');

  const cust = customerId || f.customers[0]?.id || '';
  const bill = billId || bills[0]?.[0] || '';
  const d = Number.parseInt(days, 10);
  let what: WhatIf | null = null;
  let problem = '';
  if (kind === 'payLater') {
    if (!cust) problem = t('Add a customer first.');
    else if (!Number.isFinite(d)) problem = t('Enter the number of days.');
    else what = { kind, customerId: cust, days: d };
  } else if (kind === 'newOrder') {
    const amt = rupeesOrZero(amount);
    if (!cust) problem = t('Add a customer first.');
    else if (amt <= 0) problem = t('Enter the order amount in rupees.');
    else if (!date) problem = t('Pick the order date.');
    else what = { kind, customerId: cust, amountPaise: amt, date };
  } else if (!bill) problem = t('No supplier bills or expenses fall due in the next 13 weeks.');
  else if (!Number.isFinite(d))
    problem = t('Enter the number of days (negative moves it earlier).');
  else what = { kind, expenseId: bill, days: d };

  const input = useMemo(() => toInput(f), [f]);
  const base = useMemo(() => lowestPoint(simulate(input)), [input]);
  const whatKey = what ? JSON.stringify(what) : '';
  const result = useMemo(
    () => (whatKey ? runWhatIf(input, JSON.parse(whatKey) as WhatIf) : null),
    [input, whatKey],
  );
  const names = {
    customer: f.customers.find((c) => c.id === cust)?.name,
    bill: bills.find(([id]) => id === bill)?.[1],
  };
  const low = result ? lowestPoint(result) : null;
  const sf = result ? firstShortfall(result) : null;

  return (
    <Card>
      <h2>{t('What if…')}</h2>
      <Select
        label={t('Scenario')}
        value={kind}
        onChange={(e) => setKind(e.target.value as WhatIf['kind'])}
        options={[
          { value: 'payLater', label: t('A customer pays later') },
          { value: 'newOrder', label: t('A new order comes in') },
          { value: 'moveBill', label: t('A supplier bill moves') },
        ]}
      />
      {kind !== 'moveBill' ? (
        <Select
          label={t('Customer')}
          value={cust}
          onChange={(e) => setCustomerId(e.target.value)}
          options={f.customers.map((c) => ({ value: c.id, label: c.name }))}
        />
      ) : (
        <Select
          label={t('Bill or expense')}
          value={bill}
          onChange={(e) => setBillId(e.target.value)}
          options={bills.map(([id, name]) => ({ value: id, label: name }))}
        />
      )}
      {kind !== 'newOrder' ? (
        <Input
          label={kind === 'payLater' ? t('Days later') : t('Days to move (negative = earlier)')}
          type="number"
          value={days}
          onChange={(e) => setDays(e.target.value)}
        />
      ) : (
        <>
          <Input
            label={t('Order amount (₹)')}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Input
            label={t('Order date')}
            type="date"
            value={date}
            min={f.today}
            onChange={(e) => setDate(e.target.value)}
          />
        </>
      )}
      {problem ? <p role="status">{problem}</p> : null}
      {result && what && low ? (
        <>
          <p>
            <strong>
              {tr(describeWhatIf(what, names))}
              {t('.')}
            </strong>{' '}
            {t(
              'Lowest point in the next 13 weeks goes from {{money}} (week {{week}}) to {{money2}} (week {{week2}}).',
              {
                money: money(base.paise),
                week: base.week,
                money2: money(low.paise),
                week2: low.week,
              },
            )}{' '}
            {sf
              ? t('Cash would first fall below your buffer in week {{week}}.', { week: sf.week })
              : t('Cash stays above your buffer.')}
          </p>
          <BandChart forecast={result} shortfallWeek={sf?.week ?? null} />
        </>
      ) : null}
    </Card>
  );
}

export function ForecastPage() {
  const { t } = useTranslation();
  const [includeDisputed, setIncludeDisputed] = useState(false);
  const { ctx, computed, isLoading, error, updatedAt, offline } = useForecast(includeDisputed);
  const bt = useMemo(
    () =>
      ctx ? backtest({ history: ctx.history, customers: ctx.customers, today: ctx.today }) : null,
    [ctx],
  );
  if (isLoading) return <Loading />;
  if (error) return <p role="alert">{errorMessage(error)}</p>;
  if (!ctx || !computed) return null;
  const { forecast, plan, chase } = computed;
  const sf = firstShortfall(forecast);
  const low = lowestPoint(forecast);
  const names = new Map(ctx.customers.map((c) => [c.id, c.name]));
  const customersWithHistory = [...ctx.models.byCustomer.values()]
    .filter((m) => names.has(m.customerId))
    .sort((a, b) => a.grade.localeCompare(b.grade) || b.p80 - a.p80);

  return (
    <>
      <h1 className="sr-only">{t('Forecast')}</h1>
      <HeroCard
        label={t('Forecast')}
        headline={
          sf && plan
            ? t('You may be short {{money}} around {{date}}', {
                money: formatINRShort(paise(Math.round(plan.gapPaise))),
                date: prettyDate(sf.start),
              })
            : t('Cash stays above your {{money}} safety buffer for the next {{safeWeeks}} weeks.', {
                money: money(forecast.bufferPaise),
                safeWeeks: safeWeeks(forecast),
              })
        }
      />
      <Freshness updatedAt={updatedAt} offline={offline} />
      <p className="tnum">
        {sf
          ? t(
              'Cash is expected to fall below your {{money}} safety buffer in week {{week}} ({{start}} to {{end}}).',
              { money: money(forecast.bufferPaise), week: sf.week, start: sf.start, end: sf.end },
            )
          : t('Cash stays above your {{money}} safety buffer for the next {{safeWeeks}} weeks.', {
              money: money(forecast.bufferPaise),
              safeWeeks: safeWeeks(forecast),
            })}{' '}
        {t('Lowest point: {{money}} in week {{week}}. Opening balance', {
          money: money(low.paise),
          week: low.week,
        })}{' '}
        {money(ctx.openingBalancePaise)}
        {ctx.openingBalanceOn
          ? t(' as of {{openingBalanceOn}}', { openingBalanceOn: ctx.openingBalanceOn })
          : ''}
        {t('.')}
        {sf ? <Why explain={() => explainShortfall(forecast)} /> : null}
      </p>
      {ctx.truncated ? (
        <p role="status">{t('Some lists were capped, so the numbers may be incomplete.')}</p>
      ) : null}
      <label>
        <input
          type="checkbox"
          checked={includeDisputed}
          onChange={(e) => setIncludeDisputed(e.target.checked)}
        />{' '}
        {t('Include disputed invoices (assumed 30 days later)')}
      </label>
      <Title>{t('Next 13 weeks')}</Title>
      <GlassCard variant="solid" style={{ padding: 18, marginBottom: 16 }}>
        <BandChart forecast={forecast} shortfallWeek={sf?.week ?? null} />
        <ResponsiveTable
          caption={t('Next 13 weeks')}
          rows={forecast.weeks}
          rowKey={(w) => String(w.week)}
          columns={[
            {
              key: 'week',
              header: 'Week',
              render: (w) => (
                <>
                  {w.week}
                  {sf?.week === w.week ? ` ◄ ${t('shortfall')}` : ''}
                </>
              ),
            },
            { key: 'start', header: 'Starts', render: (w) => prettyDate(w.start) },
            {
              key: 'open',
              header: 'Opening (median)',
              render: (w) => formatINRShort(paise(w.opening.p50)),
            },
            {
              key: 'in',
              header: 'In (median)',
              render: (w) => formatINRShort(paise(w.inflow.p50)),
            },
            { key: 'out', header: 'Out', render: (w) => formatINRShort(paise(w.outflow.p50)) },
            {
              key: 'p10',
              header: 'Closing P10',
              render: (w) => (
                <>
                  {formatINRShort(paise(w.closing.p10))}
                  <Why explain={() => explainForecastQuantile(forecast, w, 'closing', 'p10')} />
                </>
              ),
            },
            {
              key: 'p50',
              header: 'Closing P50',
              render: (w) => (
                <>
                  {formatINRShort(paise(w.closing.p50))}
                  <Why explain={() => explainForecastQuantile(forecast, w, 'closing', 'p50')} />
                </>
              ),
            },
            {
              key: 'p90',
              header: 'Closing P90',
              render: (w) => (
                <>
                  {formatINRShort(paise(w.closing.p90))}
                  <Why explain={() => explainForecastQuantile(forecast, w, 'closing', 'p90')} />
                </>
              ),
            },
            {
              key: 'prob',
              header: 'Chance below buffer',
              render: (w) => `${Math.round(w.probBelowBuffer * 100)}%`,
            },
          ]}
        />
        <p>
          {forecast.runs} {t('simulated runs, always the same for the same data.')}
        </p>
      </GlassCard>

      <Card>
        <h2>
          {plan ? t('Closing the week {{week}} gap', { week: plan.week }) : t('Closing a gap')}
        </h2>
        {plan ? (
          <>
            <p>{tr(plan.summary)}</p>
            <ol>
              {plan.steps.map((s) => (
                <li key={s.id}>{tr(s.sentence)}</li>
              ))}
            </ol>
            {plan.steps.length ? (
              <p className="tnum">
                {t('Total cost {{money}}; covers {{money2}} of', {
                  money: money(plan.totalCostPaise),
                  money2: money(plan.coveredPaise),
                })}{' '}
                {t('{{money}}.', { money: money(plan.gapPaise) })}
                <Why explain={() => explainSolverCost(plan)} />
              </p>
            ) : null}
          </>
        ) : (
          <p>{t('No shortfall in the next 13 weeks, so nothing to solve.')}</p>
        )}
      </Card>

      <WhatIfCard f={ctx} />

      <Card>
        <h2>{t('Who to chase first')}</h2>
        {chase.length === 0 ? <p>{t('Nothing outstanding.')}</p> : null}
        <ol>
          {chase.slice(0, 10).map((c) => (
            <li key={c.invoiceId}>
              <strong>{c.customerName}</strong>
              {t(': {{reason}}.', { reason: tr(c.reason) })}
              <Why
                explain={() =>
                  explainChaseScore(c, modelFor(ctx.models, c.customerId).grade, [
                    { label: `Customer ${c.customerName}`, href: `/customers/${c.customerId}` },
                    { label: 'Invoice', href: `/invoices/${c.invoiceId}` },
                  ])
                }
              />
            </li>
          ))}
        </ol>
        <p>
          <Link to="/collect">{t('Open Collect')}</Link>
        </p>
      </Card>

      <Card>
        <h2>
          {t('Last')} {bt?.weeks.length ?? 8} {t('weeks: forecast against actual')}
        </h2>
        {bt ? (
          <>
            <p>{tr(bt.sentence)}</p>
            <ActualVsForecastChart result={bt} />
            <p className="tnum">
              {t('WAPE')} {bt.wape === null ? 'not available' : `${Math.round(bt.wape * 100)}%`}{' '}
              {t('(lower is better). Forecast made as of {{asOf}}.', { asOf: bt.asOf })}
            </p>
          </>
        ) : null}
      </Card>

      <Card>
        <h2>{t('How reliably customers pay')}</h2>
        {customersWithHistory.length === 0 ? (
          <p>{t('No paid invoices yet, so the forecast uses a default of a few days late.')}</p>
        ) : null}
        <ul>
          {customersWithHistory.map((m) => (
            <li key={m.customerId}>
              <strong>{names.get(m.customerId)}</strong>{' '}
              {t('(grade {{grade}}): {{reason}}', { grade: m.grade, reason: tr(m.reason) })}
              <Why
                label="Why this score"
                explain={() =>
                  explainPayability(m, [{ label: 'Customer', href: `/customers/${m.customerId}` }])
                }
              />
              <Why
                label="Why this credit limit"
                explain={() => {
                  const c = ctx.customers.find((x) => x.id === m.customerId);
                  const billed = ctx.history
                    .filter(
                      (h) =>
                        h.customerId === m.customerId && daysBetween(h.issueDate, ctx.today) <= 180,
                    )
                    .reduce((a, h) => a + h.totalPaise, 0);
                  return explainCreditLimit(
                    {
                      monthlyBilledPaise: Math.round(billed / 6),
                      creditDays: c?.creditDays ?? 30,
                      p80Late: m.p80,
                    },
                    [{ label: 'Customer', href: `/customers/${m.customerId}` }],
                  );
                }}
              />
            </li>
          ))}
        </ul>
        <p>
          {t(
            'Customers with fewer than 4 paid invoices lean on your overall average. Overall: median',
          )}{' '}
          {t('{{v}} days late.', { v: Math.round(ctx.models.overall.median) })}
        </p>
      </Card>

      <p>
        <Link to="/expenses">{t('Edit expenses and bills')}</Link> {t('·')}{' '}
        <Link to="/settings">{t('Change bank balance and safety buffer')}</Link>
      </p>
    </>
  );
}
