import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CountUp, GlassCard } from '@/components/ui';
import {
  NATIONAL_ASSUMPTIONS,
  NATIONAL_BASELINES,
  NATIONAL_DEFAULTS,
  nationalImpact,
} from '@/lib/impact';
import './impact.css';

const inr = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
/** Rupees to a readable lakh / crore string. */
function rupeesShort(r: number): string {
  if (r >= 1e7) return `₹${inr(Math.round(r / 1e7))} crore`;
  if (r >= 1e5) return `₹${(r / 1e5).toFixed(1)} lakh`;
  return `₹${inr(r)}`;
}

function Slider({
  id,
  label,
  value,
  min,
  max,
  step,
  onChange,
  shown,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
  shown: string;
}) {
  return (
    <div className="nat-slider">
      <label htmlFor={id}>
        {label} <b className="num">{shown}</b>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

/** Public page: what Receivia could free up across India's MSMEs. Every figure is an editable estimate. */
export function NationalImpactPage() {
  const [adopters, setAdopters] = useState<number>(NATIONAL_DEFAULTS.adopters);
  const [recv, setRecv] = useState<number>(NATIONAL_DEFAULTS.receivablesRupees);
  const [days, setDays] = useState<number>(NATIONAL_DEFAULTS.daysFaster);
  const [rate, setRate] = useState<number>(NATIONAL_DEFAULTS.borrowingRatePct);
  const r = nationalImpact({
    adopters,
    receivablesRupees: recv,
    daysFaster: days,
    borrowingRatePct: rate,
  });
  const B = NATIONAL_BASELINES;
  return (
    <main className="nat-page">
      <h1>
        If Indian MSMEs collected faster <span className="nat-tag">Estimate</span>
      </h1>
      <p>
        Move the sliders. These are estimates built on stated assumptions, not forecasts or promises.
      </p>
      <GlassCard variant="solid" className="impact-card" aria-label="Inputs">
        <Slider
          id="nat-adopters"
          label="MSMEs using Receivia"
          value={adopters}
          min={1000}
          max={1_000_000}
          step={1000}
          onChange={setAdopters}
          shown={inr(adopters)}
        />
        <Slider
          id="nat-recv"
          label="Average receivables per MSME"
          value={recv}
          min={100_000}
          max={10_000_000}
          step={50_000}
          onChange={setRecv}
          shown={rupeesShort(recv)}
        />
        <Slider
          id="nat-days"
          label="Days to collect, reduced by"
          value={days}
          min={0}
          max={30}
          step={0.1}
          onChange={setDays}
          shown={`${days.toFixed(1)} days`}
        />
        <Slider
          id="nat-rate"
          label="Borrowing rate"
          value={rate}
          min={6}
          max={24}
          step={0.5}
          onChange={setRate}
          shown={`${rate}%`}
        />
      </GlassCard>
      <section className="nat-out" aria-live="polite">
        <GlassCard variant="solid" className="impact-card">
          <span>Working capital freed</span>
          <CountUp
            className="nat-big"
            value={r.workingCapitalFreed / 100}
            format={(n) => rupeesShort(n)}
          />
        </GlassCard>
        <GlassCard variant="solid" className="impact-card">
          <span>Interest saved a year</span>
          <CountUp
            className="nat-big"
            value={r.annualInterestSaved / 100}
            format={(n) => rupeesShort(n)}
          />
        </GlassCard>
        <GlassCard variant="solid" className="impact-card">
          <span>Days faster</span>
          <CountUp className="nat-big" value={r.daysFaster} format={(n) => `${n.toFixed(1)} days`} />
        </GlassCard>
      </section>
      <h2>Where the baselines come from</h2>
      <ul>
        <li>
          Average settlement time {B.avgSettlementDays} days. Source: {B.avgSettlementSource}.
        </li>
        <li>
          ₹{inr(B.samadhaanClaimsCrore)} crore of delayed-payment claims filed. Source:{' '}
          {B.samadhaanSource}.
        </li>
        <li>
          {B.udyamCrore} crore Udyam registrations. Source: {B.udyamSource}. At {inr(adopters)}{' '}
          adopters, that is {(r.adopterShareOfUdyam * 100).toFixed(2)}% of them.
        </li>
      </ul>
      <h2>Assumptions</h2>
      <ul>
        {NATIONAL_ASSUMPTIONS.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
      <p>
        <Link to="/how-it-works">How it works</Link> · <Link to="/sign-in">Sign in</Link>
      </p>
    </main>
  );
}
