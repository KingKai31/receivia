/** GST rate slabs in percent. Verify on cbic-gst.gov.in before relying on them. */
export const GST_RATES = [0, 0.25, 3, 5, 18, 40] as const;
export type GstRate = (typeof GST_RATES)[number];

/** e-invoicing note applies when aggregate turnover is above this (₹5 crore, in paise). */
export const E_INVOICE_THRESHOLD_PAISE = 5_000_000_000;

export const COMPOSITION_HEADING =
  'Composition taxable person, not eligible to collect tax on supplies';

export const E_INVOICE_NOTE =
  'e-invoicing may apply to this business (turnover above ₹5 crore). Check the current rules on the GST e-invoice portal.';
