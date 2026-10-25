import { Freshness } from '@/features/forecast/Freshness';
import { tr } from '@/app/i18n';
import { useTranslation } from 'react-i18next';
import { AgentPanel } from '@/features/agent/AgentPanel';
import { ImpactCard, RoiCardView } from '@/features/impact/ImpactCards';
import { AskBooks } from '@/features/ai/AskBooks';
import { ListenButton } from '@/features/ai/ListenButton';
import { Link } from 'react-router-dom';
import {
  Alert,
  ButtonLink,
  Card,
  GlassCard,
  HeroCard,
  HorizontalTiles,
  ListRow,
  Loading,
  Pill,
  RowList,
  StatTile,
  Title,
} from '@/components/ui';
import { AgeingBar, BandChart } from '@/features/forecast/charts';
import { useForecast } from '@/features/forecast/useForecast';
import { dashboardTiles, firstShortfall, safeWeeks } from '@/lib/forecast';
import { formatINR, formatINRShort, paise } from '@/lib/money';
import { errorMessage } from '@/lib/service/errors';
import '@/features/forecast/forecast.css';

const money = (n: number) => formatINR(paise(Math.round(n)));
const short = (n: number) => formatINRShort(paise(Math.round(n)));

export function TodayPage() {
  const { t } = useTranslation();
  const { ctx, computed, isLoading, error, updatedAt, offline } = useForecast();
  if (isLoading) return <Loading />;
  if (error) return <p role="alert">{errorMessage(error)}</p>;
  if (!ctx || !computed) return null;
  const { forecast, plan, chase } = computed;
  const sf = firstShortfall(forecast);
  const tiles = dashboardTiles({
    today: ctx.today,
    invoices: ctx.invoices,
    models: ctx.models,
    occurrences: ctx.occurrences,
    forecast,
    bankBalancePaise: ctx.openingBalancePaise,
  });
  const customerCount = new Set(ctx.invoices.map((i) => i.customerId)).size;
  return (
    <>
      <h1 className="sr-only">{t('Today')}</h1>
      <HeroCard
        label={t('Money to collect')}
        value={Math.round(tiles.toCollectPaise)}
        format={short}
        sub={t('{{money}} overdue · {{n}} customers', {
          money: short(tiles.overduePaise),
          n: customerCount,
        })}
      >
        <div className="hero-actions">
          <ButtonLink to="/collect" variant="light">
            {t('Send reminders')}
          </ButtonLink>
          <ButtonLink to="/invoices/new" variant="dark">
            {t('New invoice')}
          </ButtonLink>
        </div>
      </HeroCard>
      {chase.length > 0 ? (
        <GlassCard variant="solid" style={{ padding: 18, marginBottom: 16 }}>
          <h2>{t('3 things to do now')}</h2>
          <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {[...chase]
              .sort((a, b) => b.balancePaise - a.balancePaise)
              .slice(0, 3)
              .map((c) => (
                <li
                  key={c.invoiceId}
                  className="flex flex-wrap items-center justify-between gap-2"
                  style={{ padding: '6px 0' }}
                >
                  <span className="tnum">
                    {t('{{name}} owes {{money}}', {
                      name: c.customerName,
                      money: money(c.balancePaise),
                    })}
                  </span>
                  <ButtonLink to="/collect" variant="dark">
                    {t('Remind')}
                  </ButtonLink>
                </li>
              ))}
          </ol>
        </GlassCard>
      ) : null}
      <Freshness updatedAt={updatedAt} offline={offline} />
      <ListenButton
        facts={{
          toChase: chase.length,
          amountPaise: chase.reduce((s, c) => s + c.balancePaise, 0),
          shortfallWeek: sf?.week ?? null,
        }}
      />

      {sf && plan ? (
        <Alert urgent>
          <strong>
            {t('Cash is tight in week')} {sf.week}
          </strong>
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
        </Alert>
      ) : (
        <GlassCard variant="solid" style={{ padding: 18, marginBottom: 16 }}>
          <h2>{t('Cash is safe for {{safeWeeks}} weeks', { safeWeeks: safeWeeks(forecast) })}</h2>
          <p style={{ margin: 0 }}>
            {t('Median cash stays above your safety buffer for the whole 13-week forecast.')}{' '}
            <Link to="/forecast">{t('See the forecast')}</Link>
          </p>
        </GlassCard>
      )}
      {ctx.invoices.length === 0 && ctx.expenses.length === 0 ? (
        <p role="status">
          {t('Add invoices and your expenses so the forecast has something to work with.')}
        </p>
      ) : null}

      <Title>{t('This week')}</Title>
      <HorizontalTiles label={t('This week')}>
        <StatTile
          icon="up"
          index={0}
          label={t('To collect')}
          value={tiles.toCollectPaise}
          format={short}
          note={t('{{length}} open invoices', { length: ctx.invoices.length })}
        />
        <StatTile
          icon="alert"
          index={1}
          label={t('Overdue')}
          value={tiles.overduePaise}
          format={short}
        />
        <StatTile
          icon="up"
          index={0}
          label={t('Expected this week')}
          value={tiles.expectedThisWeekPaise}
          format={short}
        />
        <StatTile
          icon="clock"
          index={1}
          label={t('Expected this month')}
          value={tiles.expectedThisMonthPaise}
          format={short}
        />
        <StatTile
          icon="down"
          index={0}
          label={t('Bills due in 30 days')}
          value={tiles.billsDue30Paise}
          format={short}
        />
        <StatTile
          icon="card"
          index={1}
          label={t('Bank balance')}
          value={tiles.bankBalancePaise}
          format={short}
          note={
            ctx.openingBalanceOn
              ? t('as of {{openingBalanceOn}}', { openingBalanceOn: ctx.openingBalanceOn })
              : undefined
          }
        />
        <StatTile
          icon="clock"
          index={0}
          label={t('Lowest forecast point')}
          value={tiles.lowestPaise}
          format={short}
          note={t('week {{lowestWeek}}', { lowestWeek: tiles.lowestWeek })}
        />
      </HorizontalTiles>

      <ImpactCard dismissible />
      <RoiCardView />

      <AgentPanel compact />

      <AskBooks />

      <div className="grid-2">
        <div>
          <Title>{t('Your next 13 weeks')}</Title>
          <GlassCard variant="solid" style={{ padding: '18px 16px 14px', marginBottom: 16 }}>
            <BandChart forecast={forecast} shortfallWeek={sf?.week ?? null} />
          </GlassCard>
        </div>
        <div>
          <Title>{t('Chase these first')}</Title>
          <RowList>
            <div className="seq">
              {chase.length === 0 ? (
                <p style={{ padding: '8px 16px', margin: 0 }}>{t('Nothing outstanding.')}</p>
              ) : null}
              {chase.slice(0, 5).map((c, i) => (
                <ListRow
                  key={c.invoiceId}
                  index={i}
                  name={c.customerName}
                  meta={tr(c.reason)}
                  amount={money(c.balancePaise)}
                  to={`/invoices/${c.invoiceId}`}
                  pill={
                    <Pill tone={c.daysOverdue > 0 ? 'overdue' : 'due'}>
                      {c.daysOverdue > 0 ? t('Overdue') : t('Due soon')}
                    </Pill>
                  }
                />
              ))}
            </div>
          </RowList>
        </div>
      </div>

      <Card>
        <h2>{t('How old are the unpaid invoices?')}</h2>
        <AgeingBar ageing={tiles.ageing} />
      </Card>
    </>
  );
}
