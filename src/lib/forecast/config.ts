/**
 * Forecast and solver settings. All tunable numbers live here, not in code.
 * Rates are assumptions to check with your bank / TReDS platform before acting on them.
 */
export const FORECAST_CONFIG = {
  runs: 2000,
  weeks: 13,
  /** Fixed seed: the same inputs always give the same forecast. */
  seed: 20261024,
  /** Shrinkage: weight on a customer's own history is n / (n + k). */
  shrinkK: 5,
  /** Fewer paid invoices than this and the customer is flagged low confidence. */
  lowConfidenceBelow: 4,
  /** Grade by the shrunk P80 days late: A up to this many, B up to the next, otherwise C. */
  gradeA_p80: 7,
  gradeB_p80: 21,
  /** Used when there is no payment history at all (days late). */
  priorDelays: [0, 5, 10, 15, 25],
  /** Chance a promise to pay is kept (arrives on the promised date, within 2 days). */
  promiseKeptProb: 0.65,
  /** Remaining wait is multiplied by this once a reminder stage has been sent. */
  stageFactor: {
    pre_due: 1,
    due_today: 1,
    overdue_firm: 0.9,
    final: 0.8,
    demand_letter: 0.65,
    next_steps: 0.6,
  } as Record<string, number>,
  /** If we chase now, the remaining wait is multiplied by this. */
  chaseFactor: 0.5,
  /** Extra days when a disputed invoice is included in the forecast. */
  disputeExtraDays: 30,
  /** Probability an invoice is never collected, by days overdue (first row whose max is >= days). */
  badDebt: [
    { maxDays: 60, prob: 0 },
    { maxDays: 90, prob: 0.05 },
    { maxDays: 180, prob: 0.15 },
    { maxDays: 100000, prob: 0.3 },
  ],
  /** Early-payment discount offered to speed up payment. */
  earlyDiscountPct: 2,
  /** Chance a customer takes the early-payment offer and pays within the week. */
  earlyDiscountTakeUp: 0.6,
  /** TReDS: annual discount rate. Only company and government buyers. */
  tredsAnnualRatePct: 12,
  tredsBuyers: ['company', 'government'] as readonly string[],
  /** Deferring a supplier bill costs this much per month of delay (late fee or interest). */
  deferFeePctPerMonth: 1.5,
  /** Backtest. */
  backtestWeeks: 8,
  /** Chase score weights by reliability grade (reliable payers respond to a nudge). */
  gradeWeight: { A: 1, B: 0.85, C: 0.65 } as Record<string, number>,
  /** Week used as the target for chase scores when no shortfall is forecast. */
  noShortfallTargetWeek: 4,
} as const;

export type ForecastConfig = typeof FORECAST_CONFIG;
