import type { ISODate } from '@/lib/dates';
import { msmeDueDate, msmedInterest } from '@/lib/legal';
import { paise } from '@/lib/money';
import { IMPACT_CONFIG, type ImpactConfig } from './config';
import type { ReplayResult } from './replay';

export interface RoiInput {
  /** Reminder messages sent by Receivia (automated or one-tap) in the period. */
  messagesAutomated: number;
  replay: ReplayResult;
  /** Interest the seller may be owed under the MSMED Act on overdue invoices. */
  msmeInterestPaise: number;
  config?: ImpactConfig;
}

export interface RoiCard {
  messagesAutomated: number;
  hoursSaved: number;
  collectedSoonerPaise: number;
  msmeInterestPaise: number;
  borrowingCostAvoidedPaise: number;
}

export function roiCard(i: RoiInput): RoiCard {
  const cfg = i.config ?? IMPACT_CONFIG;
  return {
    messagesAutomated: i.messagesAutomated,
    hoursSaved: Math.round(((i.messagesAutomated * cfg.minutesPerMessage) / 60) * 10) / 10,
    collectedSoonerPaise: i.replay.amountPulledForwardPaise,
    msmeInterestPaise: i.msmeInterestPaise,
    borrowingCostAvoidedPaise: i.replay.borrowingCostAvoidedPaise,
  };
}

export interface OverdueForInterest {
  balancePaise: number;
  /** Date the buyer accepted the goods (invoice date when unknown). */
  acceptedOn: ISODate;
  creditDays: number;
  hasWrittenAgreement: boolean;
}

/** MSMED Act s.16 interest across overdue invoices; 0 when the seller is not an eligible MSME. */
export function msmeInterestOwed(
  invoices: OverdueForInterest[],
  asOf: ISODate,
  sellerEligible: boolean,
): number {
  if (!sellerEligible) return 0;
  let sum = 0;
  for (const inv of invoices) {
    const due = msmeDueDate(inv.acceptedOn, inv.creditDays, inv.hasWrittenAgreement);
    sum += msmedInterest({ principal: paise(inv.balancePaise), dueDate: due, asOf }).interest_paise;
  }
  return sum;
}
