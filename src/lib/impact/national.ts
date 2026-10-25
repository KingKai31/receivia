import type { Paise } from '@/lib/money';
import { paise } from '@/lib/money';

/** National-scale estimate. Pure maths; inputs are sliders on /impact. Estimates, not forecasts. */
export const NATIONAL_BASELINES = {
  /** Average days MSMEs wait to be paid. */
  avgSettlementDays: 73,
  avgSettlementSource:
    'Recordent, 2026 report (as supplied to this project; verify before quoting)',
  /** Delayed-payment claims filed on MSME Samadhaan, in crore rupees. */
  samadhaanClaimsCrore: 55244,
  samadhaanSource:
    'MSME Samadhaan portal, as of Aug 2026 (as supplied; verify at samadhaan.msme.gov.in)',
  /** Udyam registrations, in crore. */
  udyamCrore: 6.2,
  udyamSource: 'Udyam Registration portal (as supplied; verify at udyamregistration.gov.in)',
} as const;

export const NATIONAL_DEFAULTS = {
  adopters: 100_000,
  /** Assumption: average open receivables of one MSME, rupees. */
  receivablesRupees: 1_000_000,
  /** Default = the demo replay result (45.3 to 37.5 days); editable. */
  daysFaster: 7.8,
  borrowingRatePct: 12,
} as const;

export interface NationalInput {
  adopters: number;
  receivablesRupees: number;
  daysFaster: number;
  borrowingRatePct: number;
  baselineDays?: number;
}

export interface NationalResult {
  /** Share of receivables released, 0 to 1. */
  releasedShare: number;
  workingCapitalFreed: Paise;
  annualInterestSaved: Paise;
  daysFaster: number;
  adopterShareOfUdyam: number;
}

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

/**
 * Receivables are proportional to days to collect, so collecting d days faster out of B releases d/B of the
 * standing balance once. Interest saved is that released amount x borrowing rate, per year.
 */
export function nationalImpact(i: NationalInput): NationalResult {
  const base = i.baselineDays ?? NATIONAL_BASELINES.avgSettlementDays;
  const adopters = Math.round(clamp(i.adopters, 0, 6.2e7));
  const recv = clamp(i.receivablesRupees, 0, 1e9);
  const days = clamp(i.daysFaster, 0, base);
  const rate = clamp(i.borrowingRatePct, 0, 60) / 100;
  const share = base > 0 ? days / base : 0;
  const freedRupees = adopters * recv * share;
  return {
    releasedShare: share,
    workingCapitalFreed: paise(Math.round(freedRupees * 100)),
    annualInterestSaved: paise(Math.round(freedRupees * rate * 100)),
    daysFaster: days,
    adopterShareOfUdyam: adopters / (NATIONAL_BASELINES.udyamCrore * 1e7),
  };
}

export const NATIONAL_ASSUMPTIONS = [
  'Receivables are proportional to days to collect, so collecting faster releases days faster / 73 of what is owed, once.',
  'Average open receivables per MSME is an assumption you can change; it is not a measured national figure.',
  'Days faster defaults to the replay on the demo business (45.3 to 37.5 days) and may not hold elsewhere.',
  'Interest saved = working capital freed x borrowing rate, for one year, as if all of it replaced borrowing.',
  'Adopters are a slider, not a forecast of adoption. This is an estimate, not a promise.',
] as const;
