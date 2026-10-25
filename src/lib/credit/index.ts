/** Credit limit per customer from the delay model and recent billing; a manual limit overrides it. */
export const CREDIT_CONFIG = {
  /** Look-back window for billing, in days. */
  windowDays: 180,
  /** Headroom over the typical outstanding amount. */
  headroom: 1.25,
  /** Never suggest less than this many days of billing. */
  minDaysOfBilling: 30,
} as const;

export interface CreditInput {
  /** Total invoiced to this customer inside the window (paise). */
  billedInWindowPaise: number;
  creditDays: number;
  /** Typical days late for this customer (P80 from the delay model, 0 if early). */
  usualDelayDays: number;
  manualLimitPaise: number | null;
  /** Open balance today (paise). */
  exposurePaise: number;
  /** Total of the invoice being drafted (paise). */
  newInvoicePaise: number;
}

export interface CreditCheck {
  limitPaise: number;
  source: 'manual' | 'model' | 'none';
  afterPaise: number;
  overPaise: number;
  exceeded: boolean;
  usualDelayDays: number;
}

/** Limit = daily billing x days the money typically stays out (credit days + usual delay) x headroom. */
export function creditLimitFor(i: CreditInput): {
  limitPaise: number;
  source: 'manual' | 'model' | 'none';
} {
  if (i.manualLimitPaise !== null) return { limitPaise: i.manualLimitPaise, source: 'manual' };
  if (i.billedInWindowPaise <= 0) return { limitPaise: Number.MAX_SAFE_INTEGER, source: 'none' };
  const perDay = i.billedInWindowPaise / CREDIT_CONFIG.windowDays;
  const days = Math.max(
    i.creditDays + Math.max(i.usualDelayDays, 0),
    CREDIT_CONFIG.minDaysOfBilling,
  );
  return { limitPaise: Math.round(perDay * days * CREDIT_CONFIG.headroom), source: 'model' };
}

export function checkCredit(i: CreditInput): CreditCheck {
  const { limitPaise, source } = creditLimitFor(i);
  const afterPaise = i.exposurePaise + i.newInvoicePaise;
  const overPaise = source === 'none' ? 0 : Math.max(afterPaise - limitPaise, 0);
  return {
    limitPaise,
    source,
    afterPaise,
    overPaise,
    exceeded: overPaise > 0,
    usualDelayDays: i.usualDelayDays,
  };
}
