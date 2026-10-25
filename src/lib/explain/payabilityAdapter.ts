// TODO-merge: call src/lib/payability from feat/payability. The explain entries for the payability score and the
// credit limit are thin adapters: they show the raw inputs and whatever this engine returns, and carry no formula
// of their own. The merge session wires `payabilityEngine` to the real functions and fills `formula` from them.
import type { CustomerDelay } from '@/lib/forecast';

export const payabilityEngine: {
  score: (d: CustomerDelay) => number | null;
  creditLimit: (a: {
    monthlyBilledPaise: number;
    creditDays: number;
    p80Late: number;
  }) => number | null;
} = {
  score: () => null,
  creditLimit: () => null,
};
