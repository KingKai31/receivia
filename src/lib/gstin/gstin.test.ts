import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GST_STATES, type StateCode } from '@/lib/gst/states';
import {
  generateGstin,
  gstinCheckChar,
  isValidGstin,
  stateCodeOfGstin,
  validateGstin,
} from './index';

const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const codes = Object.keys(GST_STATES) as StateCode[];

describe('gstin', () => {
  it('check char matches a known published GSTIN (27AAPFU0939F1ZV)', () => {
    expect(gstinCheckChar('27AAPFU0939F1Z')).toBe('V');
    expect(isValidGstin('27AAPFU0939F1ZV')).toBe(true);
  });

  it('generated GSTINs are valid and carry the requested state', () => {
    fc.assert(
      fc.property(fc.constantFrom(...codes), fc.integer(), (code, seed) => {
        let s = seed >>> 0;
        const rand = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
        const g = generateGstin(code, rand);
        const res = validateGstin(g);
        expect(res.valid).toBe(true);
        expect(stateCodeOfGstin(g)).toBe(code);
      }),
    );
  });

  it('changing any single character makes it invalid', () => {
    for (const code of ['27', '29', '97', '99'] as StateCode[]) {
      const g = generateGstin(code, () => 0.37);
      expect(isValidGstin(g)).toBe(true);
      for (let i = 0; i < g.length; i++) {
        for (const c of CHARSET) {
          if (c === g[i]) continue;
          expect(isValidGstin(g.slice(0, i) + c + g.slice(i + 1))).toBe(false);
        }
      }
    }
  });

  it('rejects wrong length, pattern, unknown state, bad checksum', () => {
    expect(validateGstin('27AAPFU0939F1Z')).toEqual({ valid: false, reason: 'LENGTH' });
    expect(validateGstin('27aapfu0939f1z!')).toEqual({ valid: false, reason: 'PATTERN' });
    const unknown = '00AAPFU0939F1Z' + gstinCheckChar('00AAPFU0939F1Z');
    expect(validateGstin(unknown)).toEqual({ valid: false, reason: 'STATE' });
    expect(validateGstin('27AAPFU0939F1ZX')).toEqual({ valid: false, reason: 'CHECKSUM' });
  });

  it('accepts lowercase and surrounding spaces', () => {
    expect(isValidGstin(' 27aapfu0939f1zv ')).toBe(true);
  });
});
