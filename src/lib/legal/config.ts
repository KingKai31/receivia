/** Legal reference numbers kept in config, not code. */
export const LEGAL_CONFIG = {
  /** RBI bank rate, percent per year. Check rbi.org.in before relying on it. */
  rbiBankRatePct: 5.75,
  /** MSMED Act s.16: three times the bank rate. */
  interestMultiple: 3,
  itcDays: 180,
  msmeMaxAgreedDays: 45,
  msmeDefaultDays: 15,
} as const;
