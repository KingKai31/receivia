import { addDays, daysBetween } from '@/lib/dates';
import { arrivalAtoms, draw, sampler } from './arrival';
import { FORECAST_CONFIG } from './config';
import { makeRng, quantileSorted } from './stats';
import type { Forecast, ForecastInput, Quantiles, WeekBand } from './types';

function q(values: number[]): Quantiles {
  const s = [...values].sort((a, b) => a - b);
  return {
    p10: Math.round(quantileSorted(s, 0.1)),
    p50: Math.round(quantileSorted(s, 0.5)),
    p90: Math.round(quantileSorted(s, 0.9)),
  };
}

/**
 * 13-week Monte Carlo cash forecast. Each run draws an arrival day for every open invoice (due date +
 * sampled delay, see arrivalAtoms) and applies the known outflows. Per run and week:
 * closing = opening + inflow - outflow, and next week's opening is this week's closing.
 * Deterministic for a given input and seed.
 */
export function simulate(input: ForecastInput): Forecast {
  const runs = input.runs ?? FORECAST_CONFIG.runs;
  const weeks = input.weeks ?? FORECAST_CONFIG.weeks;
  const rng = makeRng(input.seed ?? FORECAST_CONFIG.seed);
  const { today } = input;
  const horizon = weeks * 7;

  // Known outflows by week (identical in every run).
  const outByWeek = new Array<number>(weeks).fill(0);
  let outflowTotal = 0;
  for (const o of input.occurrences) {
    const off = daysBetween(today, o.date);
    if (off < 0 || off >= horizon) continue;
    outByWeek[Math.floor(off / 7)]! += o.amountPaise;
    outflowTotal += o.amountPaise;
  }

  const samplers = input.invoices.map((inv) => ({
    inv,
    s: sampler(arrivalAtoms(inv, today, input.models, { includeDisputed: input.includeDisputed })),
  }));
  const simulatedBalance = samplers.reduce((s, x) => s + x.inv.balancePaise, 0);

  const paths = {
    opening: [] as number[][],
    inflow: [] as number[][],
    outflow: [] as number[][],
    closing: [] as number[][],
  };
  for (let r = 0; r < runs; r++) {
    const inflow = new Array<number>(weeks).fill(0);
    for (const { inv, s } of samplers) {
      const off = draw(s, rng());
      if (off === null || off >= horizon) continue;
      inflow[Math.floor(off / 7)]! += inv.balancePaise;
    }
    const opening: number[] = [];
    const closing: number[] = [];
    let bal = input.openingBalancePaise;
    for (let w = 0; w < weeks; w++) {
      opening.push(bal);
      bal = bal + inflow[w]! - outByWeek[w]!;
      closing.push(bal);
    }
    paths.opening.push(opening);
    paths.inflow.push(inflow);
    paths.outflow.push([...outByWeek]);
    paths.closing.push(closing);
  }

  const bands: WeekBand[] = [];
  for (let w = 0; w < weeks; w++) {
    const col = (a: number[][]) => a.map((row) => row[w]!);
    const closing = col(paths.closing);
    const inflow = col(paths.inflow);
    bands.push({
      week: w + 1,
      start: addDays(today, w * 7),
      end: addDays(today, w * 7 + 6),
      opening: q(col(paths.opening)),
      inflow: q(inflow),
      outflow: q(col(paths.outflow)),
      closing: q(closing),
      probBelowBuffer: closing.filter((c) => c < input.bufferPaise).length / runs,
      expectedInflow: Math.round(inflow.reduce((s, x) => s + x, 0) / runs),
    });
  }
  return {
    today,
    runs,
    bufferPaise: input.bufferPaise,
    weeks: bands,
    paths,
    outflowTotalPaise: outflowTotal,
    simulatedBalancePaise: simulatedBalance,
  };
}

/** First week whose median closing balance is below the buffer, or null when cash stays safe. */
export function firstShortfall(f: Forecast): WeekBand | null {
  return f.weeks.find((w) => w.closing.p50 < f.bufferPaise) ?? null;
}

/** Number of weeks from the start until the first shortfall (all weeks if none). */
export function safeWeeks(f: Forecast): number {
  const s = firstShortfall(f);
  return s ? s.week - 1 : f.weeks.length;
}

/** The lowest median closing balance and the week it happens in. */
export function lowestPoint(f: Forecast): { week: number; paise: number } {
  let best = { week: 1, paise: Number.POSITIVE_INFINITY };
  for (const w of f.weeks)
    if (w.closing.p50 < best.paise) best = { week: w.week, paise: w.closing.p50 };
  return best;
}
