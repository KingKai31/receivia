import { tr } from '@/app/i18n';
import { useTranslation } from 'react-i18next';
import type { BacktestResult, Forecast } from '@/lib/forecast';
import type { AgeingBuckets } from '@/lib/forecast';
import { formatINRShort } from '@/lib/money';
import { paise } from '@/lib/money';
import './forecast.css';

/** SVG charts in the approved style: gradient band and line, dashed safety level, marker pop-in. */

const W = 640;
const H = 280;
const PAD = { l: 64, r: 12, t: 12, b: 28 };

function scale(min: number, max: number) {
  const span = max - min || 1;
  return (v: number) => PAD.t + (1 - (v - min) / span) * (H - PAD.t - PAD.b);
}

function short(n: number): string {
  return formatINRShort(paise(Math.round(n)));
}

export function BandChart({
  forecast,
  shortfallWeek,
}: {
  forecast: Forecast;
  shortfallWeek: number | null;
}) {
  const { t } = useTranslation();
  const weeks = forecast.weeks;
  const all = weeks.flatMap((w) => [w.closing.p10, w.closing.p90]).concat(forecast.bufferPaise, 0);
  const min = Math.min(...all);
  const max = Math.max(...all);
  const y = scale(min, max);
  const x = (i: number) => PAD.l + (i + 0.5) * ((W - PAD.l - PAD.r) / weeks.length);
  const band = [
    ...weeks.map((w, i) => `${x(i)},${y(w.closing.p90)}`),
    ...[...weeks].reverse().map((w, i) => `${x(weeks.length - 1 - i)},${y(w.closing.p10)}`),
  ].join(' ');
  const line = weeks.map((w, i) => `${x(i)},${y(w.closing.p50)}`).join(' ');
  const ticks = [min, (min + max) / 2, max];
  const sx = shortfallWeek ? x(shortfallWeek - 1) : 0;
  const sy = shortfallWeek ? y(weeks[shortfallWeek - 1]!.closing.p50) : 0;
  return (
    <>
      <svg
        className="chart tnum fc"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={t(
          'Forecast closing cash by week: median line, 10th to 90th percentile band and the safety buffer',
        )}
      >
        <defs>
          <linearGradient id="fc-band" x1="0" x2="1">
            <stop offset="0" stopColor="#9fb3c6" stopOpacity=".6" />
            <stop offset="1" stopColor="#e3a892" stopOpacity=".55" />
          </linearGradient>
          <linearGradient id="fc-line" x1="0" x2="1">
            <stop offset="0" stopColor="#56708c" />
            <stop offset="1" stopColor="#c4694e" />
          </linearGradient>
        </defs>
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--muted)"
              opacity={0.18}
            />
            <text x={PAD.l - 6} y={y(tick) + 4} textAnchor="end" fontSize="12" fill="var(--muted)">
              {short(tick)}
            </text>
          </g>
        ))}
        {min < 0 ? (
          <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} stroke="var(--muted)" opacity={0.5} />
        ) : null}
        <polygon className="fc-band" points={band} fill="url(#fc-band)" />
        <polyline
          className="fc-line"
          points={line}
          pathLength={1}
          fill="none"
          stroke="url(#fc-line)"
          strokeWidth={2.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <line
          x1={PAD.l}
          x2={W - PAD.r}
          y1={y(forecast.bufferPaise)}
          y2={y(forecast.bufferPaise)}
          stroke="var(--warn)"
          strokeWidth={1.5}
          strokeDasharray="5 5"
        />
        <text
          x={W - PAD.r}
          y={y(forecast.bufferPaise) - 5}
          textAnchor="end"
          fontSize="12"
          fill="var(--warn)"
        >
          {t('Safety buffer {{short}}', { short: short(forecast.bufferPaise) })}
        </text>
        {weeks.map((w, i) => (
          <text
            key={w.week}
            x={x(i)}
            y={H - 8}
            textAnchor="middle"
            fontSize="12"
            fill="var(--muted)"
          >
            {w.week}
          </text>
        ))}
        {shortfallWeek ? (
          <g className="fc-mark" style={{ transformOrigin: `${sx}px ${sy}px` }}>
            <circle cx={sx} cy={sy} r={10} fill="var(--warn)" fillOpacity={0.2} />
            <circle cx={sx} cy={sy} r={5} fill="var(--warn)" />
          </g>
        ) : null}
      </svg>
      {shortfallWeek ? (
        <p className="ui-hint">{t('First shortfall: week {{shortfallWeek}}', { shortfallWeek })}</p>
      ) : null}
      <div className="fc-legend">
        <span>
          <i style={{ background: 'linear-gradient(90deg,#56708c,#c4694e)' }} />
          {t('Likely')}
        </span>
        <span>
          <i style={{ background: 'linear-gradient(90deg,#9fb3c6,#e3a892)', height: 8 }} />
          {t('Range')}
        </span>
        <span>
          <i style={{ background: 'var(--warn)' }} />
          {t('Safety level')}
        </span>
      </div>
    </>
  );
}

export function ActualVsForecastChart({ result }: { result: BacktestResult }) {
  const { t } = useTranslation();
  const rows = result.weeks;
  const max = Math.max(1, ...rows.flatMap((r) => [r.actual, r.p90, r.forecast]));
  const y = scale(0, max);
  const step = (W - PAD.l - PAD.r) / rows.length;
  const bw = Math.min(28, step / 3);
  return (
    <svg
      className="chart tnum"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={t('Collections each week: forecast with its range against what actually came in')}
    >
      {[0, max / 2, max].map((t) => (
        <g key={t}>
          <line
            x1={PAD.l}
            x2={W - PAD.r}
            y1={y(t)}
            y2={y(t)}
            stroke="currentColor"
            opacity={0.12}
          />
          <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="currentColor">
            {short(t)}
          </text>
        </g>
      ))}
      {rows.map((r, i) => {
        const cx = PAD.l + (i + 0.5) * step;
        return (
          <g key={r.week}>
            <rect
              x={cx - bw - 2}
              y={y(r.forecast)}
              width={bw}
              height={y(0) - y(r.forecast)}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
            />
            <line
              x1={cx - bw / 2 - 2}
              x2={cx - bw / 2 - 2}
              y1={y(r.p10)}
              y2={y(r.p90)}
              stroke="currentColor"
              opacity={0.6}
            />
            <rect
              x={cx + 2}
              y={y(r.actual)}
              width={bw}
              height={y(0) - y(r.actual)}
              fill="currentColor"
              opacity={0.7}
            />
            <text x={cx} y={H - 8} textAnchor="middle" fontSize="11" fill="currentColor">
              {r.week}
            </text>
          </g>
        );
      })}
      <text x={PAD.l} y={PAD.t + 10} fontSize="11" fill="currentColor">
        {t('Outlined bar: forecast (line: 10th to 90th percentile). Solid bar: actual.')}
      </text>
    </svg>
  );
}

const AGEING_LABELS: [keyof AgeingBuckets, string, number][] = [
  ['notDue', 'Not due', 0.25],
  ['d1_30', '1–30 days', 0.4],
  ['d31_60', '31–60 days', 0.55],
  ['d61_90', '61–90 days', 0.75],
  ['d90plus', 'Over 90 days', 1],
];

export function AgeingBar({ ageing }: { ageing: AgeingBuckets }) {
  const { t } = useTranslation();
  const total = Object.values(ageing).reduce((s, x) => s + x, 0);
  return (
    <div className="tnum">
      <svg
        viewBox="0 0 640 28"
        className="chart"
        role="img"
        aria-label={t(
          'Receivables by age: not due, 1 to 30, 31 to 60, 61 to 90 and over 90 days overdue',
        )}
      >
        {(() => {
          let x = 0;
          return AGEING_LABELS.map(([k, , o]) => {
            const w = total > 0 ? (ageing[k] / total) * 640 : 0;
            const el = (
              <rect key={k} x={x} y={0} width={w} height={28} fill="currentColor" opacity={o} />
            );
            x += w;
            return el;
          });
        })()}
      </svg>
      <ul className="ageing-legend">
        {AGEING_LABELS.map(([k, label]) => (
          <li key={k}>
            {t('{{label}}: {{short}}', { label: tr(label), short: short(ageing[k]) })}
          </li>
        ))}
      </ul>
    </div>
  );
}
