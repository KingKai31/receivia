/** Payability settings. Verify the e-way bill and HSN rules on cbic-gst.gov.in before relying on them. */
export const PAYABILITY_CONFIG = {
  /** Issue is blocked below this score unless the owner overrides (business_profile.payability_threshold). */
  defaultThreshold: 70,
  /** Inter-state goods above this value (paise, ₹50,000) need an e-way bill number. */
  ewayBillThresholdPaise: 5_000_000,
  /** Points per check; they add up to 100. */
  weights: {
    gstin: 15,
    po: 10,
    apContact: 15,
    delivery: 20,
    hsn: 10,
    terms: 15,
    bank: 15,
  },
  /** HSN digits by aggregate turnover (paise): up to ₹1.5 crore none required, up to ₹5 crore 4, above 6. */
  hsnTiers: [
    { upToPaise: 1_500_000_000, digits: 0 },
    { upToPaise: 5_000_000_000, digits: 4 },
    { upToPaise: Number.MAX_SAFE_INTEGER, digits: 6 },
  ],
} as const;
