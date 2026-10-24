import { addDays, type ISODate } from '@/lib/dates';
import { simulate } from './simulate';
import type { Forecast, ForecastInput, OpenInvoice } from './types';

export type WhatIf =
  | { kind: 'payLater'; customerId: string; days: number }
  | {
      kind: 'newOrder';
      customerId: string;
      amountPaise: number;
      date: ISODate;
      creditDays?: number;
    }
  | { kind: 'moveBill'; expenseId: string; days: number; date?: ISODate };

/** Returns a modified copy of the input; the original is never changed. */
export function applyWhatIf(input: ForecastInput, w: WhatIf): ForecastInput {
  switch (w.kind) {
    case 'payLater': {
      // Every sampled arrival for this customer moves `days` later (promises too).
      const invoices = input.invoices.map((i) =>
        i.customerId === w.customerId
          ? { ...i, extraDelayDays: (i.extraDelayDays ?? 0) + w.days }
          : i,
      );
      return { ...input, invoices };
    }
    case 'newOrder': {
      const cust = input.customers.find((c) => c.id === w.customerId);
      const credit = w.creditDays ?? cust?.creditDays ?? 30;
      const inv: OpenInvoice = {
        id: `whatif-order-${w.customerId}-${w.date}`,
        customerId: w.customerId,
        dueDate: addDays(w.date, credit),
        balancePaise: Math.round(w.amountPaise),
      };
      return { ...input, invoices: [...input.invoices, inv] };
    }
    case 'moveBill': {
      const occurrences = input.occurrences.map((o) =>
        o.expenseId === w.expenseId && (!w.date || o.date === w.date)
          ? { ...o, date: addDays(o.date, w.days) }
          : o,
      );
      return { ...input, occurrences };
    }
  }
}

export function runWhatIf(input: ForecastInput, w: WhatIf): Forecast {
  return simulate(applyWhatIf(input, w));
}

export function describeWhatIf(w: WhatIf, names: { customer?: string; bill?: string }): string {
  switch (w.kind) {
    case 'payLater':
      return `${names.customer ?? 'This customer'} pays ${w.days} day${w.days === 1 ? '' : 's'} later than usual`;
    case 'newOrder':
      return `A new order from ${names.customer ?? 'a customer'} on ${w.date}`;
    case 'moveBill':
      return `${names.bill ?? 'This bill'} moves ${w.days >= 0 ? 'later' : 'earlier'} by ${Math.abs(w.days)} day${Math.abs(w.days) === 1 ? '' : 's'}`;
  }
}
