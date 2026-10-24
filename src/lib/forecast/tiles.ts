import { daysBetween, type ISODate } from '@/lib/dates';
import { arrivalAtoms, expectedBy } from './arrival';
import { lowestPoint, safeWeeks } from './simulate';
import type { DelayModels, Forecast, Occurrence, OpenInvoice } from './types';

export interface AgeingBuckets {
  notDue: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
}

export interface Tiles {
  toCollectPaise: number;
  overduePaise: number;
  expectedThisWeekPaise: number;
  expectedThisMonthPaise: number;
  billsDue30Paise: number;
  bankBalancePaise: number;
  lowestPaise: number;
  lowestWeek: number;
  safeWeeks: number;
  ageing: AgeingBuckets;
}

export function ageing(invoices: OpenInvoice[], today: ISODate): AgeingBuckets {
  const b: AgeingBuckets = { notDue: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 };
  for (const i of invoices) {
    const late = daysBetween(i.dueDate, today);
    if (late <= 0) b.notDue += i.balancePaise;
    else if (late <= 30) b.d1_30 += i.balancePaise;
    else if (late <= 60) b.d31_60 += i.balancePaise;
    else if (late <= 90) b.d61_90 += i.balancePaise;
    else b.d90plus += i.balancePaise;
  }
  return b;
}

export function dashboardTiles(args: {
  today: ISODate;
  invoices: OpenInvoice[];
  models: DelayModels;
  occurrences: Occurrence[];
  forecast: Forecast;
  bankBalancePaise: number;
}): Tiles {
  const { today, invoices } = args;
  let week = 0;
  let month = 0;
  for (const i of invoices) {
    const atoms = arrivalAtoms(i, today, args.models);
    week += expectedBy(i, atoms, 6);
    month += expectedBy(i, atoms, 29);
  }
  const low = lowestPoint(args.forecast);
  return {
    toCollectPaise: invoices.reduce((s, i) => s + i.balancePaise, 0),
    overduePaise: invoices
      .filter((i) => daysBetween(i.dueDate, today) > 0)
      .reduce((s, i) => s + i.balancePaise, 0),
    expectedThisWeekPaise: week,
    expectedThisMonthPaise: month,
    billsDue30Paise: args.occurrences
      .filter((o) => {
        const d = daysBetween(today, o.date);
        return d >= 0 && d < 30;
      })
      .reduce((s, o) => s + o.amountPaise, 0),
    bankBalancePaise: args.bankBalancePaise,
    lowestPaise: low.paise,
    lowestWeek: low.week,
    safeWeeks: safeWeeks(args.forecast),
    ageing: ageing(invoices, today),
  };
}
