import type { ISODate } from '@/lib/dates';

/** All amounts are integer paise. */

export type EntityKind = 'company' | 'firm' | 'proprietor' | 'government' | 'individual' | null;

export interface CustomerInfo {
  id: string;
  name: string;
  entityType: EntityKind;
  creditDays: number;
}

/** A payment applied to an invoice. */
export interface SettlementEvent {
  date: ISODate;
  amountPaise: number;
}

/** An invoice with its payment events: input for the delay model and the backtest. */
export interface HistInvoice {
  id: string;
  customerId: string;
  issueDate: ISODate;
  dueDate: ISODate;
  totalPaise: number;
  events: SettlementEvent[];
  /** Set when the invoice was closed some other way (credit note, TDS); else derived from events. */
  closedOn?: ISODate | null;
}

export interface OpenInvoice {
  id: string;
  number?: string;
  customerId: string;
  dueDate: ISODate;
  balancePaise: number;
  disputed?: boolean;
  /** Highest reminder stage already sent. */
  stage?: string | null;
  /** Active promise to pay: the promised date. */
  promisedFor?: ISODate | null;
  /** What-if: extra days added to every sampled arrival. */
  extraDelayDays?: number;
}

export type Grade = 'A' | 'B' | 'C';

export interface DelayStats {
  n: number;
  mean: number;
  median: number;
  p80: number;
}

export interface CustomerDelay {
  customerId: string;
  /** Days late on past paid invoices (negative = early). */
  samples: number[];
  n: number;
  /** Own statistics, before shrinking. */
  own: DelayStats;
  /** Shrunk toward the overall distribution with weight n / (n + k). */
  weight: number;
  mean: number;
  median: number;
  p80: number;
  lowConfidence: boolean;
  grade: Grade;
  reason: string;
}

export interface DelayModels {
  overall: DelayStats & { samples: number[]; fromPrior: boolean };
  byCustomer: Map<string, CustomerDelay>;
  k: number;
}

export interface Occurrence {
  expenseId: string;
  name: string;
  date: ISODate;
  amountPaise: number;
  deferrable: boolean;
}

export interface Expense {
  id: string;
  name: string;
  kind?: string | null;
  amountPaise: number;
  expenseDate: ISODate;
  isRecurring: boolean;
  recurrence: 'weekly' | 'monthly' | 'quarterly' | 'yearly' | null;
  nextDue: ISODate | null;
  endsOn: ISODate | null;
  active: boolean;
  deferrable: boolean;
}

export interface Quantiles {
  p10: number;
  p50: number;
  p90: number;
}

export interface WeekBand {
  week: number;
  start: ISODate;
  end: ISODate;
  opening: Quantiles;
  inflow: Quantiles;
  outflow: Quantiles;
  closing: Quantiles;
  /** Chance the closing balance is below the safety buffer. */
  probBelowBuffer: number;
  /** Average collections in the week across runs. */
  expectedInflow: number;
}

export interface Forecast {
  today: ISODate;
  runs: number;
  bufferPaise: number;
  weeks: WeekBand[];
  /** Per run, per week (index 0 = week 1). Closing of week i equals opening of week i + 1. */
  paths: { opening: number[][]; inflow: number[][]; outflow: number[][]; closing: number[][] };
  /** Total outflow occurrences in the horizon, for reconciliation. */
  outflowTotalPaise: number;
  /** Sum of balances of invoices that were simulated. */
  simulatedBalancePaise: number;
}

export interface ForecastInput {
  today: ISODate;
  openingBalancePaise: number;
  bufferPaise: number;
  invoices: OpenInvoice[];
  customers: CustomerInfo[];
  models: DelayModels;
  occurrences: Occurrence[];
  includeDisputed?: boolean;
  runs?: number;
  weeks?: number;
  seed?: number;
}
