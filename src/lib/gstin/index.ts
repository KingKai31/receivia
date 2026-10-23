import { GST_STATES, isStateCode, type StateCode } from '@/lib/gst/states';

const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export type GstinReason = 'LENGTH' | 'PATTERN' | 'STATE' | 'CHECKSUM';
export type GstinResult =
  { valid: true; stateCode: StateCode } | { valid: false; reason: GstinReason };

/** GSTN check character: mod-36 over the first 14 characters. */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = CHARSET.indexOf(first14[i]!);
    const product = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARSET[(36 - (sum % 36)) % 36]!;
}

export function validateGstin(input: string): GstinResult {
  const g = input.trim().toUpperCase();
  if (g.length !== 15) return { valid: false, reason: 'LENGTH' };
  if (!PATTERN.test(g)) return { valid: false, reason: 'PATTERN' };
  const state = g.slice(0, 2);
  if (!isStateCode(state)) return { valid: false, reason: 'STATE' };
  if (gstinCheckChar(g.slice(0, 14)) !== g[14]) return { valid: false, reason: 'CHECKSUM' };
  return { valid: true, stateCode: state };
}

export function isValidGstin(input: string): boolean {
  return validateGstin(input).valid;
}

/** First two digits of a GSTIN, or null if it is not a known state code. */
export function stateCodeOfGstin(gstin: string): StateCode | null {
  const s = gstin.slice(0, 2);
  return isStateCode(s) ? s : null;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Generates a made-up but structurally valid GSTIN (for seeds and tests). Not a real taxpayer.
 * `rand` returns a float in [0, 1); defaults to Math.random.
 */
export function generateGstin(stateCode: StateCode, rand: () => number = Math.random): string {
  const pick = (chars: string) => chars[Math.floor(rand() * chars.length)]!;
  if (!(stateCode in GST_STATES)) throw new Error(`Unknown state code ${stateCode}`);
  const pan =
    pick(LETTERS) +
    pick(LETTERS) +
    pick(LETTERS) +
    pick('CFPH') +
    pick(LETTERS) +
    pick('0123456789') +
    pick('0123456789') +
    pick('0123456789') +
    pick('0123456789') +
    pick(LETTERS);
  const first14 = `${stateCode}${pan}${pick('123456789')}Z`;
  return first14 + gstinCheckChar(first14);
}
