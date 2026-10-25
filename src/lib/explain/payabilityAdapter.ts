// Customer-level explanations reuse the real engines: the reliability grade comes from the delay model
// (src/lib/forecast) and the credit limit from src/lib/credit. The invoice-level payability checklist lives in
// src/lib/payability and explains itself through its own check reasons.
import { creditLimitFor, CREDIT_CONFIG } from '@/lib/credit';

export const payabilityEngine = {
  creditLimit: (a: { monthlyBilledPaise: number; creditDays: number; p80Late: number }) =>
    creditLimitFor({
      billedInWindowPaise: a.monthlyBilledPaise * (CREDIT_CONFIG.windowDays / 30),
      creditDays: a.creditDays,
      usualDelayDays: a.p80Late,
      manualLimitPaise: null,
      exposurePaise: 0,
      newInvoicePaise: 0,
    }),
};
