import { FORECAST_CONFIG } from '@/lib/forecast/config';

/**
 * Assumptions for the impact replay. These are modelling assumptions, not measurements: the replay
 * shows what the same invoices would have done IF customers responded the way the delay model assumes.
 */
export const IMPACT_CONFIG = {
  /** Months of history replayed. */
  months: 6,
  /** Days after the due date at which each reminder stage goes out (the default ladder). */
  stageDays: { overdue_firm: 7, final: 15, demand_letter: 30, next_steps: 45 } as Record<
    string,
    number
  >,
  /** Once a stage is sent, the wait that remains is multiplied by the forecast model's factor. */
  stageFactor: FORECAST_CONFIG.stageFactor,
  /** Share of days-late removed by the friendly reminders before and on the due date (day -3 and day 0). */
  friendlyNudgeShare: 0.5,
  /** Share of the days an invoice sat in a dispute or payability hold that an upfront fix removes. */
  payabilityFixShare: 0.7,
  /** Share of a missed promise's slippage that promise tracking (a chase on the promised date) removes. */
  promiseSlipRecovery: 0.5,
  /** Cost of borrowing to cover a late receipt, per year. Set to your actual overdraft rate. */
  borrowingRatePct: 12,
  /** Minutes of staff time to write, send and log one reminder by hand. */
  minutesPerMessage: 3,
} as const;

export type ImpactConfig = typeof IMPACT_CONFIG;

export const IMPACT_ASSUMPTIONS: string[] = [
  'Same invoices, same customers, same amounts; only the payment dates change.',
  'Friendly reminders 3 days before and on the due date remove half of the days a customer would have been late.',
  'Reminders on schedule (day 7, 15, 30 and 45 after the due date): once a stage is sent, the wait that remains is cut by the forecast model stage factor (0.9, 0.8, 0.65, 0.6).',
  'Payability fixes: invoices that sat in a dispute or hold lose 70% of those days.',
  'Promise tracking: when a customer paid after their promised date, half of that slippage is recovered.',
  'Invoices still unpaid today stay unpaid in both runs, and early or on-time payers do not change.',
  'Borrowing cost is 12% a year on the money that arrives sooner. Change it to your overdraft rate.',
  'This is an estimate from your own history, not a promise of results.',
];
