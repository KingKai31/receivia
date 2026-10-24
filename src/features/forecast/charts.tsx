import type { BacktestResult, Forecast } from '@/lib/forecast';
import type { AgeingBuckets } from '@/lib/forecast';
import { formatINRShort } from '@/lib/money';
import { paise } from '@/lib/money';
import './forecast.css';

/** Plain SVG charts. Colours are neutral (currentColor); the design pass restyles them. */

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
  return (
    <svg
      className="chart tnum"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Forecast closing cash by week: median line, 10th to 90th percentile band and the safety buffer"
    >
      {ticks.map((t) => (
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
      {min < 0 ? (
        <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} stroke="currentColor" opacity={0.4} />
      ) : null}
      <polygon points={band} fill="currentColor" opacity={0.15} />
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth={2} />
      <line
        x1={PAD.l}
        x2={W - PAD.r}
        y1={y(forecast.bufferPaise)}
        y2={y(forecast.bufferPaise)}
        stroke="currentColor"
        strokeWidth={1.5}
        strokeDasharray="6 4"
      />
      <text
        x={W - PAD.r}
        y={y(forecast.bufferPaise) - 4}
        textAnchor="end"
        fontSize="11"
        fill="currentColor"
      >
        Safety buffer {short(forecast.bufferPaise)}
      </text>
      {weeks.map((w, i) => (
        <text key={w.week} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="currentColor">
          {w.week}
        </text>
      ))}
      {shortfallWeek ? (
        <g>
          <line
            x1={x(shortfallWeek - 1)}
            x2={x(shortfallWeek - 1)}
            y1={PAD.t}
            y2={H - PAD.b}
            stroke="currentColor"
            strokeWidth={1.5}
            strokeDasharray="2 3"
          />
          <circle
            cx={x(shortfallWeek - 1)}
            cy={y(weeks[shortfallWeek - 1]!.closing.p50)}
            r={5}
            fill="currentColor"
          />
          <text x={x(shortfallWeek - 1) + 8} y={PAD.t + 12} fontSize="11" fill="currentColor">
            First shortfall: week {shortfallWeek}
          </text>
        </g>
      ) : null}
    </svg>
  );
}

export function ActualVsForecastChart({ result }: { result: BacktestResult }) {
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
      aria-label="Collections each week: forecast with its range against what actually came in"
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
        Outlined bar: forecast (line: 10th to 90th percentile). Solid bar: actual.
      </text>
    </svg>
  );
}

const AGEING_LABELS: [keyof AgeingBuckets, string, number][] = [
  ['notDue', 'Not due', 0.25],
  ['d1_30', '1–30 days', 0.4],
  ['d31_60', '31–60', 0.55],
  ['d61_90', '61–90', 0.75],
  ['d90plus', '90+', 1],
];

export function AgeingBar({ ageing }: { ageing: AgeingBuckets }) {
  const total = Object.values(ageing).reduce((s, x) => s + x, 0);
  return (
    <div className="tnum">
      <svg
        viewBox="0 0 640 28"
        className="chart"
        role="img"
        aria-label="Receivables by age: not due, 1 to 30, 31 to 60, 61 to 90 and over 90 days overdue"
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
            {label}: {short(ageing[k])}
          </li>
        ))}
      </ul>
    </div>
  );
}
