import {
  createElement,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';
import { useCountUp, useScrollProgress } from '@/lib/motion';

/** Display components of the approved design: one file, tokens only (styles in ui.css). */

export function CountUp({
  value,
  format,
  className = '',
}: {
  value: number;
  format: (n: number) => string;
  className?: string;
}) {
  const n = useCountUp(value);
  return <span className={`num ${className}`}>{format(n)}</span>;
}

/** Settles from `from` down to 0 (paid state). */
export function CountDown({
  from,
  format,
  className = '',
}: {
  from: number;
  format: (n: number) => string;
  className?: string;
}) {
  const n = useCountUp(from);
  return <span className={`num ${className}`}>{format(from - n)}</span>;
}

export interface GlassCardProps extends HTMLAttributes<HTMLElement> {
  variant?: 'glass' | 'solid';
  as?: 'section' | 'div' | 'article' | 'aside';
  reveal?: boolean;
  children: ReactNode;
}

/** Frosted card. Use variant="solid" under dense text and numbers. */
export function GlassCard({
  variant = 'glass',
  as: Tag = 'div',
  reveal = true,
  className = '',
  ...rest
}: GlassCardProps) {
  return (
    <Tag
      className={`glass ${variant === 'solid' ? 'glass-solid' : ''} ${reveal ? 'rv' : ''} ${className}`}
      {...rest}
    />
  );
}

export interface HeroCardProps {
  label: string;
  headline?: ReactNode;
  value?: number;
  format?: (n: number) => string;
  sub?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/** Blue → coral hero for the one main figure on a screen. */
export function HeroCard({
  label,
  headline,
  value,
  format,
  sub,
  children,
  className = '',
}: HeroCardProps) {
  return (
    <section className={`hero page-enter ${className}`} aria-label={label}>
      <span className="hero-label">{label}</span>
      {headline ? <p className="hero-headline">{headline}</p> : null}
      {value !== undefined && format ? (
        <div className="hero-big">
          <CountUp value={value} format={format} />
        </div>
      ) : null}
      {sub ? <div className="hero-sub num">{sub}</div> : null}
      {children}
    </section>
  );
}

export type PillTone = 'neutral' | 'overdue' | 'due' | 'paid' | 'peach';

/** Status is always a word; colour only reinforces it. */
export function Pill({ tone = 'neutral', children }: { tone?: PillTone; children: ReactNode }) {
  return (
    <span className="pill" data-tone={tone}>
      {children}
    </span>
  );
}

export function Avatar({ name, index = 0 }: { name: string; index?: number }) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[1]?.[0] ?? '') : '')
  ).toUpperCase();
  return (
    <span className="avatar" data-tone={index % 2 ? 'blue' : 'peach'} aria-hidden="true">
      {initials || '·'}
    </span>
  );
}

const ICONS = {
  up: 'M12 19V5M5 12l7-7 7 7',
  down: 'M12 5v14M5 12l7 7 7-7',
  card: 'M4 7h16v10H4zM8 12h8',
  clock: 'M12 7v5l3 2M12 21a9 9 0 100-18 9 9 0 000 18z',
  alert: 'M12 8v5M12 17h.01M12 3l10 18H2z',
} as const;

export interface StatTileProps {
  label: string;
  value: number | string;
  format?: (n: number) => string;
  icon?: keyof typeof ICONS;
  index?: number;
  note?: ReactNode;
}

export function StatTile({ label, value, format, icon = 'card', index = 0, note }: StatTileProps) {
  return (
    <div className="glass glass-solid stat-tile">
      <span className="stat-ico" data-tone={index % 2 ? 'peach' : 'blue'}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d={ICONS[icon]} />
        </svg>
      </span>
      <div>
        <b className="stat-value num">
          {typeof value === 'number' && format ? <CountUp value={value} format={format} /> : value}
        </b>
        <span className="stat-label">{label}</span>
        {note ? (
          <span className="stat-label" style={{ display: 'block' }}>
            {note}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Scroll-snap carousel of tiles. */
export function HorizontalTiles({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="h-tiles seq" role="group" aria-label={label}>
      {children}
    </div>
  );
}

export interface ListRowProps {
  name: string;
  meta?: ReactNode;
  amount?: ReactNode;
  pill?: ReactNode;
  to?: string;
  index?: number;
}

export function ListRow({ name, meta, amount, pill, to, index = 0 }: ListRowProps) {
  const body = (
    <>
      <Avatar name={name} index={index} />
      <div className="list-who">
        <b>{name}</b>
        {meta ? <span className="num">{meta}</span> : null}
      </div>
      <div className="list-amt">
        {amount ? <b className="num">{amount}</b> : null}
        {pill}
      </div>
    </>
  );
  return to ? (
    <Link to={to} className="list-row">
      {body}
    </Link>
  ) : (
    <div className="list-row">{body}</div>
  );
}

/** Glass container for ListRows. */
export function RowList({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div className="glass glass-solid rv ui-list" style={{ marginBottom: 16 }}>
      {title ? <h2 style={{ padding: '6px 16px 0' }}>{title}</h2> : null}
      {children}
    </div>
  );
}

export interface TimelineStep {
  key: string;
  title: ReactNode;
  detail?: ReactNode;
  time?: ReactNode;
}

/** Rail fills with scroll progress; steps light up in turn. */
export function Timeline({ steps, label }: { steps: TimelineStep[]; label?: string }) {
  const ref = useRef<HTMLOListElement>(null);
  const p = useScrollProgress(ref);
  return (
    <ol
      ref={ref}
      className="glass glass-solid timeline"
      aria-label={label}
      style={{ '--p': p } as CSSProperties}
    >
      <li className="rail" aria-hidden="true" style={{ listStyle: 'none' }}>
        <i />
      </li>
      {steps.map((s, i) => (
        <li key={s.key} className={`step ${p >= (i + 0.2) / steps.length ? 'on' : ''}`}>
          {s.time ? <time>{s.time}</time> : null}
          <b>{s.title}</b>
          {s.detail ? <span>{s.detail}</span> : null}
        </li>
      ))}
    </ol>
  );
}

/** Half-circle gauge for a 0..100 percentage: arc draws and the number counts up. */
export function Gauge({ percent, label }: { percent: number; label: string }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const end = 157 * (1 - Math.max(0, Math.min(100, percent)) / 100);
  return (
    <div className="glass glass-solid gauge rv">
      <svg viewBox="0 0 124 72" aria-hidden="true" style={{ '--arc-end': end } as CSSProperties}>
        <defs>
          <linearGradient id="arcg" x1="0" x2="1">
            <stop offset="0" stopColor="#56708c" />
            <stop offset="1" stopColor="#c4694e" />
          </linearGradient>
        </defs>
        <path
          className="arc-track"
          d="M12 64 A50 50 0 0 1 112 64"
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
        />
        <path
          className={`arc ${on ? 'arc-on' : ''}`}
          d="M12 64 A50 50 0 0 1 112 64"
          fill="none"
          stroke="url(#arcg)"
          strokeWidth="10"
          strokeLinecap="round"
        />
      </svg>
      <div>
        <b>
          <CountUp value={Math.round(percent)} format={(n) => `${n}%`} />
        </b>
        <span>{label}</span>
      </div>
    </div>
  );
}

export interface MoneyLine {
  label: ReactNode;
  amount: ReactNode;
}

/** GST breakdown; the last line is the bold total. */
export function MoneyTable({ lines, caption }: { lines: MoneyLine[]; caption?: string }) {
  return (
    <div className="glass glass-solid rv" style={{ padding: 18, marginBottom: 16 }}>
      <table className="money-table num">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>{l.label}</td>
              <td>{l.amount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Pulsing dot + sentence. */
export function Alert({ children, urgent = false }: { children: ReactNode; urgent?: boolean }) {
  return (
    <div className="glass glass-solid ui-alert rv" role={urgent ? 'alert' : 'status'}>
      <span className="dot" aria-hidden="true" />
      <div className="alert-body">{children}</div>
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ minHeight: i === 0 ? 140 : 72 }} />
      ))}
    </div>
  );
}

/** Section title with masked word-by-word slide-up (80ms stagger). */
export function Title({
  children,
  as = 'h2',
  className = '',
}: {
  children: string;
  as?: 'h1' | 'h2' | 'h3';
  className?: string;
}) {
  const words = children.split(' ').filter(Boolean);
  return createElement(
    as,
    { className: `words ${className}` },
    words.map((w, i) => (
      <span key={i} className="w">
        <span style={{ transitionDelay: `${i * 80}ms` }}>{w}&nbsp;</span>
      </span>
    )),
  );
}

/** Link that looks like a Button. */
export function ButtonLink({
  to,
  variant = 'light',
  children,
}: {
  to: string;
  variant?: 'light' | 'dark' | 'ghost';
  children: ReactNode;
}) {
  return (
    <Link to={to} className="ui-button" data-variant={variant}>
      {children}
    </Link>
  );
}
