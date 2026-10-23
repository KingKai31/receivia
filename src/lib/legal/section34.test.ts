import { describe, expect, it } from 'vitest';
import { section34Deadline, section34Warning } from './section34';

describe('section 34', () => {
  it('deadline is 30 November after the end of the invoice financial year', () => {
    expect(section34Deadline('2026-10-01')).toBe('2027-11-30');
    expect(section34Deadline('2027-03-31')).toBe('2027-11-30');
    expect(section34Deadline('2027-04-01')).toBe('2028-11-30');
  });
  it('warns with hedged wording at each level', () => {
    const ok = section34Warning('2026-10-01', '2026-11-01');
    expect(ok.level).toBe('ok');
    expect(section34Warning('2026-10-01', '2027-11-15').level).toBe('soon');
    const late = section34Warning('2026-10-01', '2027-12-01');
    expect(late.level).toBe('late');
    for (const w of [ok, late]) {
      expect(w.text).toMatch(/generally|may/);
      expect(w.text).toContain('Section 34');
      expect(w.text.endsWith('General information, not legal or tax advice.')).toBe(true);
    }
  });
});
