import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Input, Select } from '@/components/ui';
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
    if (!cust) problem = 'Add a customer first.';
    else if (!Number.isFinite(d)) problem = 'Enter the number of days.';
    else what = { kind, customerId: cust, days: d };
  } else if (kind === 'newOrder') {
    const amt = rupeesOrZero(amount);
    if (!cust) problem = 'Add a customer first.';
    else if (amt <= 0) problem = 'Enter the order amount in rupees.';
    else if (!date) problem = 'Pick the order date.';
    else what = { kind, customerId: cust, amountPaise: amt, date };
  } else if (!bill) problem = 'No supplier bills or expenses fall due in the next 13 weeks.';
  else if (!Number.isFinite(d)) problem = 'Enter the number of days (negative moves it earlier).';
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
      <h2>What if…</h2>
      <Select
        label="Scenario"
        value={kind}
        onChange={(e) => setKind(e.target.value as WhatIf['kind'])}
        options={[
          { value: 'payLater', label: 'A customer pays later' },
          { value: 'newOrder', label: 'A new order comes in' },
          { value: 'moveBill', label: 'A supplier bill moves' },
        ]}
      />
      {kind !== 'moveBill' ? (
        <Select
          label="Customer"
          value={cust}
          onChange={(e) => setCustomerId(e.target.value)}
          options={f.customers.map((c) => ({ value: c.id, label: c.name }))}
        />
      ) : (
        <Select
          label="Bill or expense"
          value={bill}
          onChange={(e) => setBillId(e.target.value)}
          options={bills.map(([id, name]) => ({ value: id, label: name }))}
        />
      )}
      {kind !== 'newOrder' ? (
        <Input
          label={kind === 'payLater' ? 'Days later' : 'Days to move (negative = earlier)'}
          type="number"
          value={days}
          onChange={(e) => setDays(e.target.value)}
        />
      ) : (
        <>
          <Input
            label="Order amount (₹)"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Input
            label="Order date"
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
            <strong>{describeWhatIf(what, names)}.</strong> Lowest point in the next 13 weeks goes
            from {money(base.paise)} (week {base.week}) to {money(low.paise)} (week {low.week}).{' '}
            {sf
              ? `Cash would first fall below your buffer in week ${sf.week}.`
              : 'Cash stays above your buffer.'}
          </p>
          <BandChart forecast={result} shortfallWeek={sf?.week ?? null} />
        </>
      ) : null}
    </Card>
  );
}

export function ForecastPage() {
  const [includeDisputed, setIncludeDisputed] = useState(false);
  const { ctx, computed, isLoading, error } = useForecast(includeDisputed);
  const bt = useMemo(
    () =>
      ctx ? backtest({ history: ctx.history, customers: ctx.customers, today: ctx.today }) : null,
    [ctx],
  );
  if (isLoading) return <p>Loading…</p>;
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
      <h1>Forecast</h1>
      <p className="tnum">
        {sf
          ? `Cash is expected to fall below your ${money(forecast.bufferPaise)} safety buffer in week ${sf.week} (${sf.start} to ${sf.end}).`
          : `Cash stays above your ${money(forecast.bufferPaise)} safety buffer for the next ${safeWeeks(forecast)} weeks.`}{' '}
        Lowest point: {money(low.paise)} in week {low.week}. Opening balance{' '}
        {money(ctx.openingBalancePaise)}
        {ctx.openingBalanceOn ? ` as of ${ctx.openingBalanceOn}` : ''}.
      </p>
      {ctx.truncated ? (
        <p role="status">Some lists were capped, so the numbers may be incomplete.</p>
      ) : null}
      <label>
        <input
          type="checkbox"
          checked={includeDisputed}
          onChange={(e) => setIncludeDisputed(e.target.checked)}
        />{' '}
        Include disputed invoices (assumed 30 days later)
      </label>
      <Card>
        <h2>Next 13 weeks</h2>
        <BandChart forecast={forecast} shortfallWeek={sf?.week ?? null} />
        <div className="table-scroll">
          <table className="tnum">
            <thead>
              <tr>
                <th>Week</th>
                <th>Starts</th>
                <th>Opening (median)</th>
                <th>In (median)</th>
                <th>Out</th>
                <th>Closing P10</th>
                <th>Closing P50</th>
                <th>Closing P90</th>
                <th>Chance below buffer</th>
              </tr>
            </thead>
            <tbody>
              {forecast.weeks.map((w) => (
                <tr key={w.week}>
                  <td>
                    {w.week}
                    {sf?.week === w.week ? ' ◄' : ''}
                  </td>
                  <td>{w.start}</td>
                  <td>{formatINRShort(paise(w.opening.p50))}</td>
                  <td>{formatINRShort(paise(w.inflow.p50))}</td>
                  <td>{formatINRShort(paise(w.outflow.p50))}</td>
                  <td>{formatINRShort(paise(w.closing.p10))}</td>
                  <td>{formatINRShort(paise(w.closing.p50))}</td>
                  <td>{formatINRShort(paise(w.closing.p90))}</td>
                  <td>{Math.round(w.probBelowBuffer * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>{forecast.runs} simulated runs, always the same for the same data.</p>
      </Card>

      <Card>
        <h2>{plan ? `Closing the week ${plan.week} gap` : 'Closing a gap'}</h2>
        {plan ? (
          <>
            <p>{plan.summary}</p>
            <ol>
              {plan.steps.map((s) => (
                <li key={s.id}>{s.sentence}</li>
              ))}
            </ol>
            {plan.steps.length ? (
              <p className="tnum">
                Total cost {money(plan.totalCostPaise)}; covers {money(plan.coveredPaise)} of{' '}
                {money(plan.gapPaise)}.
              </p>
            ) : null}
          </>
        ) : (
          <p>No shortfall in the next 13 weeks, so nothing to solve.</p>
        )}
      </Card>

      <WhatIfCard f={ctx} />

      <Card>
        <h2>Who to chase first</h2>
        {chase.length === 0 ? <p>Nothing outstanding.</p> : null}
        <ol>
          {chase.slice(0, 10).map((c) => (
            <li key={c.invoiceId}>
              <strong>{c.customerName}</strong>: {c.reason}.
            </li>
          ))}
        </ol>
        <p>
          <Link to="/collect">Open Collect</Link>
        </p>
      </Card>

      <Card>
        <h2>Last {bt?.weeks.length ?? 8} weeks: forecast against actual</h2>
        {bt ? (
          <>
            <p>{bt.sentence}</p>
            <ActualVsForecastChart result={bt} />
            <p className="tnum">
              WAPE {bt.wape === null ? 'not available' : `${Math.round(bt.wape * 100)}%`} (lower is
              better). Forecast made as of {bt.asOf}.
            </p>
          </>
        ) : null}
      </Card>

      <Card>
        <h2>How reliably customers pay</h2>
        {customersWithHistory.length === 0 ? (
          <p>No paid invoices yet, so the forecast uses a default of a few days late.</p>
        ) : null}
        <ul>
          {customersWithHistory.map((m) => (
            <li key={m.customerId}>
              <strong>{names.get(m.customerId)}</strong> (grade {m.grade}): {m.reason}
            </li>
          ))}
        </ul>
        <p>
          Customers with fewer than 4 paid invoices lean on your overall average. Overall: median{' '}
          {Math.round(ctx.models.overall.median)} days late.
        </p>
      </Card>

      <p>
        <Link to="/expenses">Edit expenses and bills</Link> ·{' '}
        <Link to="/settings">Change bank balance and safety buffer</Link>
      </p>
    </>
  );
}
