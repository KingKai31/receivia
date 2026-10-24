import { Freshness } from '@/features/forecast/Freshness';
import { tr } from '@/app/i18n';
import { useTranslation } from 'react-i18next';
import { AgentPanel } from '@/features/agent/AgentPanel';
import { Link } from 'react-router-dom';
import { Card, Loading } from '@/components/ui';
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
  const { t } = useTranslation();
  const { ctx, computed, isLoading, error, updatedAt, offline } = useForecast();
  if (isLoading) return <Loading />;
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
      <h1>{t('Today')}</h1>
      <Freshness updatedAt={updatedAt} offline={offline} />
      <AgentPanel compact />
      <Card>
        {sf && plan ? (
          <>
            <h2>
              {t('Cash is tight in week')} {sf.week}
            </h2>
            <p>
              {safeWeeks(forecast) > 0
                ? t('Cash is safe for {{safeWeeks}} weeks, then ', {
                    safeWeeks: safeWeeks(forecast),
                  })
                : t('Cash ')}
              {t('is expected to end week {{week}} {{money}} below your safety buffer.', {
                week: sf.week,
                money: money(plan.gapPaise),
              })}
            </p>
            <p className="tnum">
              {plan.steps.length === 0
                ? t('Nothing available can close the gap in time.')
                : plan.feasible
                  ? t('These steps cover it for about {{money}} in total:', {
                      money: money(plan.totalCostPaise),
                    })
                  : t('Even all available steps leave {{money}} short. Best steps:', {
                      money: money(plan.gapPaise - plan.coveredPaise),
                    })}
            </p>
            <ol>
              {plan.steps.slice(0, 3).map((s) => (
                <li key={s.id}>{tr(s.sentence)}</li>
              ))}
            </ol>
            <p>
              <Link to="/forecast">{t('See the full plan')}</Link>
            </p>
          </>
        ) : (
          <>
            <h2>{t('Cash is safe for {{safeWeeks}} weeks', { safeWeeks: safeWeeks(forecast) })}</h2>
            <p>
              {t('Median cash stays above your safety buffer for the whole 13-week forecast.')}{' '}
              <Link to="/forecast">{t('See the forecast')}</Link>
            </p>
          </>
        )}
        {ctx.invoices.length === 0 && ctx.expenses.length === 0 ? (
          <p role="status">
            {t('Add invoices and your expenses so the forecast has something to work with.')}
          </p>
        ) : null}
      </Card>
      <div className="tiles">
        <Tile
          label={t('To collect')}
          value={short(tiles.toCollectPaise)}
          note={t('{{length}} open invoices', { length: ctx.invoices.length })}
        />
        <Tile label={t('Overdue')} value={short(tiles.overduePaise)} />
        <Tile label={t('Expected this week')} value={short(tiles.expectedThisWeekPaise)} />
        <Tile label={t('Expected this month')} value={short(tiles.expectedThisMonthPaise)} />
        <Tile label={t('Bills due in 30 days')} value={short(tiles.billsDue30Paise)} />
        <Tile
          label={t('Bank balance')}
          value={short(tiles.bankBalancePaise)}
          note={
            ctx.openingBalanceOn
              ? t('as of {{openingBalanceOn}}', { openingBalanceOn: ctx.openingBalanceOn })
              : undefined
          }
        />
        <Tile
          label={t('Lowest forecast point')}
          value={short(tiles.lowestPaise)}
          note={t('week {{lowestWeek}}', { lowestWeek: tiles.lowestWeek })}
        />
      </div>
      <Card>
        <h2>{t('How old are the unpaid invoices?')}</h2>
        <AgeingBar ageing={tiles.ageing} />
      </Card>
    </>
  );
}
