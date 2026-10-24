import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { tr } from '@/app/i18n';
import { Button, CountUp, GlassCard, Loading } from '@/components/ui';
import { useOrg } from '@/features/auth/useOrg';
import { useForecast } from '@/features/forecast/useForecast';
import { IMPACT_ASSUMPTIONS, IMPACT_CONFIG } from '@/lib/impact';
import { formatINRShort, paise } from '@/lib/money';
import { loadImpact } from './impactService';
import './impact.css';

const short = (n: number) => formatINRShort(paise(Math.round(n)));
const KEY = 'receivia.impact.dismissed';

function dismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** Replay + ROI numbers for the signed-in org, from the forecast inputs already loaded. */
export function useImpact() {
  const org = useOrg();
  const { ctx } = useForecast();
  return useQuery({
    queryKey: ['impact', org.data?.orgId, ctx?.today],
    enabled: Boolean(org.data?.orgId && ctx),
    queryFn: () => loadImpact(org.data!.orgId, ctx!),
    staleTime: 5 * 60_000,
  });
}

function Pair({
  label,
  before,
  after,
  format,
  go,
}: {
  label: string;
  before: number;
  after: number;
  format: (n: number) => string;
  go: boolean;
}) {
  const { t } = useTranslation();
  const max = Math.max(before, after, 1);
  return (
    <div className="impact-pair">
      <b>{label}</b>
      <div className="impact-row">
        <span>{t('As it happened')}</span>
        <i
          className="impact-bar"
          data-kind="before"
          style={{ width: go ? `${(before / max) * 100}%` : 0 }}
        />
        <span className="num">{format(before)}</span>
      </div>
      <div className="impact-row">
        <span>{t('With Receivia')}</span>
        <i
          className="impact-bar"
          data-kind="after"
          style={{ width: go ? `${(after / max) * 100}%` : 0 }}
        />
        <span className="num">{format(after)}</span>
      </div>
    </div>
  );
}

/** Animated before / after card. `dismissible` is used on Today; /how-it-works shows it always. */
export function ImpactCard({ dismissible = false }: { dismissible?: boolean }) {
  const { t } = useTranslation();
  const q = useImpact();
  const [gone, setGone] = useState(dismissible && dismissed());
  const [go, setGo] = useState(false);
  useEffect(() => {
    if (!q.data) return;
    const id = requestAnimationFrame(() => setGo(true));
    return () => cancelAnimationFrame(id);
  }, [q.data]);
  if (gone) return null;
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return null;
  const r = q.data.replay;
  if (r.invoicesPaid === 0) return null;
  const days = (n: number) => `${n.toFixed(1)} ${t('days')}`;
  return (
    <GlassCard
      variant="solid"
      className="impact-card"
      aria-label={t('Your last 6 months, replayed')}
    >
      <div className="impact-head">
        <h2>{t('Your last 6 months, replayed')}</h2>
        {dismissible ? (
          <Button
            variant="ghost"
            onClick={() => {
              setGone(true);
              try {
                localStorage.setItem(KEY, '1');
              } catch {
                /* private window: dismissal lasts for this visit only */
              }
            }}
          >
            {t('Dismiss')}
          </Button>
        ) : null}
      </div>
      <p>
        {t(
          'The same invoices, run twice: as they happened, and with Receivia reminding on schedule, fixing payability issues and tracking promises.',
        )}
      </p>
      <Pair
        label={t('Average days to collect')}
        before={r.asHappened.avgDaysToCollect}
        after={r.withReceivia.avgDaysToCollect}
        format={days}
        go={go}
      />
      <Pair
        label={t('Overdue at last month end')}
        before={r.asHappened.overdueLatestPaise}
        after={r.withReceivia.overdueLatestPaise}
        format={short}
        go={go}
      />
      <Pair
        label={t('Weeks below your safety buffer')}
        before={r.asHappened.shortfallWeeks}
        after={r.withReceivia.shortfallWeeks}
        format={(n) => String(n)}
        go={go}
      />
      <p className="impact-total num">
        {t('Shortfall weeks avoided')}: <b>{r.shortfallWeeksAvoided}</b> ·{' '}
        {t('Borrowing cost avoided')}:{' '}
        <b>
          <CountUp value={r.borrowingCostAvoidedPaise} format={short} />
        </b>
      </p>
      <details open>
        <summary>{t('Assumptions')}</summary>
        <ul className="impact-assumptions">
          {IMPACT_ASSUMPTIONS.map((a) => (
            <li key={a}>{tr(a)}</li>
          ))}
        </ul>
      </details>
    </GlassCard>
  );
}

/** What Receivia saved you: hours, rupees sooner, MSMED interest you may be owed. */
export function RoiCardView() {
  const { t } = useTranslation();
  const q = useImpact();
  if (!q.data) return null;
  const c = q.data.roi;
  return (
    <GlassCard variant="solid" className="impact-card" aria-label={t('What Receivia saved you')}>
      <h2>{t('What Receivia saved you')}</h2>
      <dl className="impact-roi num">
        <div>
          <dt>{t('Hours saved')}</dt>
          <dd>
            <CountUp value={c.hoursSaved} format={(n) => n.toFixed(1)} />
          </dd>
          <small>
            {t('{{n}} messages × {{m}} minutes', {
              n: c.messagesAutomated,
              m: IMPACT_CONFIG.minutesPerMessage,
            })}
          </small>
        </div>
        <div>
          <dt>{t('Rupees collected sooner')}</dt>
          <dd>
            <CountUp value={c.collectedSoonerPaise} format={short} />
          </dd>
        </div>
        <div>
          <dt>{t('MSMED interest you may be owed')}</dt>
          <dd>
            <CountUp value={c.msmeInterestPaise} format={short} />
          </dd>
          <small>
            {t(
              'Section 16, three times the RBI bank rate. General information, not legal or tax advice.',
            )}
          </small>
        </div>
      </dl>
    </GlassCard>
  );
}
