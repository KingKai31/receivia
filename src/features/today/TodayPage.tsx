import { Link } from 'react-router-dom';
import { Card } from '@/components/ui';
import { AgeingBar } from '@/features/forecast/charts';
import { useForecast } from '@/features/forecast/useForecast';
import { dashboardTiles, firstShortfall, safeWeeks } from '@/lib/forecast';
import { formatINR, formatINRShort, paise } from '@/lib/money';
import { errorMessage } from '@/lib/service/errors';
import '@/features/forecast/forecast.css';

const money = (n: number) => formatINR(paise(Math.round(n)));

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="tile tnum">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {note ? <div className="tile-label">{note}</div> : null}
    </div>
  );
}

export function TodayPage() {
  const { ctx, computed, isLoading, error } = useForecast();
  if (isLoading) return <p>Loading…</p>;
  if (error) return <p role="alert">{errorMessage(error)}</p>;
  if (!ctx || !computed) return null;
  const { forecast, plan } = computed;
  const sf = firstShortfall(forecast);
  const tiles = dashboardTiles({
    today: ctx.today,
    invoices: ctx.invoices,
    models: ctx.models,
    occurrences: ctx.occurrences,
    forecast,
    bankBalancePaise: ctx.openingBalancePaise,
  });
  const short = (n: number) => formatINRShort(paise(Math.round(n)));
  return (
    <>
      <h1>Today</h1>
      <Card>
        {sf && plan ? (
          <>
            <h2>Cash is tight in week {sf.week}</h2>
            <p>
              {safeWeeks(forecast) > 0
                ? `Cash is safe for ${safeWeeks(forecast)} week${safeWeeks(forecast) === 1 ? '' : 's'}, then `
                : 'Cash '}
              is expected to end week {sf.week} {money(plan.gapPaise)} below your safety buffer.
            </p>
            <p className="tnum">
              {plan.steps.length === 0
                ? 'Nothing available can close the gap in time.'
                : plan.feasible
                  ? `These steps cover it for about ${money(plan.totalCostPaise)} in total:`
                  : `Even all available steps leave ${money(plan.gapPaise - plan.coveredPaise)} short. Best steps:`}
            </p>
            <ol>
              {plan.steps.slice(0, 3).map((s) => (
                <li key={s.id}>{s.sentence}</li>
              ))}
            </ol>
            <p>
              <Link to="/forecast">See the full plan</Link>
            </p>
          </>
        ) : (
          <>
            <h2>Cash is safe for {safeWeeks(forecast)} weeks</h2>
            <p>
              Median cash stays above your safety buffer for the whole 13-week forecast.{' '}
              <Link to="/forecast">See the forecast</Link>
            </p>
          </>
        )}
        {ctx.invoices.length === 0 && ctx.expenses.length === 0 ? (
          <p role="status">
            Add invoices and your expenses so the forecast has something to work with.
          </p>
        ) : null}
      </Card>
      <div className="tiles">
        <Tile
          label="To collect"
          value={short(tiles.toCollectPaise)}
          note={`${ctx.invoices.length} open invoices`}
        />
        <Tile label="Overdue" value={short(tiles.overduePaise)} />
        <Tile label="Expected this week" value={short(tiles.expectedThisWeekPaise)} />
        <Tile label="Expected this month" value={short(tiles.expectedThisMonthPaise)} />
        <Tile label="Bills due in 30 days" value={short(tiles.billsDue30Paise)} />
        <Tile
          label="Bank balance"
          value={short(tiles.bankBalancePaise)}
          note={ctx.openingBalanceOn ? `as of ${ctx.openingBalanceOn}` : undefined}
        />
        <Tile
          label="Lowest forecast point"
          value={short(tiles.lowestPaise)}
          note={`week ${tiles.lowestWeek}`}
        />
      </div>
      <Card>
        <h2>How old are the unpaid invoices?</h2>
        <AgeingBar ageing={tiles.ageing} />
      </Card>
    </>
  );
}
