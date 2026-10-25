import type { ISODate } from '@/lib/dates';

export type AcceptanceSource = 'buyer_confirmed' | 'proof_uploaded' | 'assumed_delivery_date';

export interface Acceptance {
  date: ISODate;
  /** True unless the buyer confirmed or the owner uploaded proof. */
  assumed: boolean;
  label: string;
}

/**
 * The date MSMED (s.15) and 43B(h) lines count from. Buyer confirmation or uploaded proof makes it firm;
 * a delivery date the owner typed, or nothing (invoice date), is "assumed".
 */
export function acceptanceOf(inv: {
  issue_date: ISODate;
  accepted_on?: ISODate | null;
  acceptance_source?: AcceptanceSource | null;
}): Acceptance {
  const date = inv.accepted_on ?? inv.issue_date;
  const firm =
    !!inv.accepted_on &&
    (inv.acceptance_source === 'buyer_confirmed' || inv.acceptance_source === 'proof_uploaded');
  const label = firm
    ? inv.acceptance_source === 'buyer_confirmed'
      ? 'Confirmed by the buyer'
      : 'Delivery proof on file'
    : inv.accepted_on
      ? 'Assumed from the delivery date'
      : 'Assumed from the invoice date';
  return { date, assumed: !firm, label };
}
