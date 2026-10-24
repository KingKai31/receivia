import { describe, expect, it } from 'vitest';
import { TEMPLATES, SLOTS, renderTemplate } from '@/features/collect/templates';
import { BANNED_WORDS } from '@/features/agent/draft';
import { pickChannel } from '@/features/agent/planner';
import { nextStepsGuide } from '@/features/collect/ladder';
import {
  ESCALATION,
  FORMAL_TEMPLATES,
  governmentGuide,
  isCpse,
  isGovernmentPath,
} from './government';

describe('government path', () => {
  it('detects government entity type or PSU flag', () => {
    expect(isGovernmentPath({ entity_type: 'government' })).toBe(true);
    expect(isGovernmentPath({ entity_type: 'company', is_psu: true })).toBe(true);
    expect(isGovernmentPath({ entity_type: 'company' })).toBe(false);
    expect(isCpse({ entity_type: 'government' })).toBe(false);
  });
  it('Form I and TReDS only for PSU/CPSE buyers, both hedged with the disclaimer', () => {
    const dept = governmentGuide({ entity_type: 'government' });
    expect(dept.formI).toBeNull();
    expect(dept.treds).toBeNull();
    const psu = governmentGuide({ entity_type: 'company', is_psu: true });
    for (const s of [psu.formI!, psu.treds!]) {
      expect(s.en).toMatch(/may|generally/);
      expect(s.en).toContain('General information, not legal or tax advice.');
      expect(s.hi).toBeTruthy();
      expect(s.mr).toBeTruthy();
    }
  });
  it('has nodal officer, Samadhaan and CPGRAMS steps with checklists in all languages', () => {
    expect(ESCALATION.map((e) => e.key)).toEqual(['nodal', 'samadhaan', 'cpgrams']);
    for (const e of ESCALATION) {
      expect(e.checklist.length).toBeGreaterThan(1);
      for (const c of e.checklist) expect(c.hi && c.mr && c.en).toBeTruthy();
    }
  });
  it('formal templates use the same slots, are formal and render with real values', () => {
    const values = Object.fromEntries(SLOTS.map((s) => [s, `<${s}>`])) as never;
    for (const stage of Object.keys(TEMPLATES) as (keyof typeof TEMPLATES)[]) {
      for (const lang of ['en', 'hi', 'mr'] as const) {
        const f = FORMAL_TEMPLATES[stage][lang];
        for (const m of f.matchAll(/\{\{(\w+)\}\}/g)) expect(SLOTS).toContain(m[1]);
        expect(f).toContain('{{invoice_no}}');
        expect(f).toContain('{{pay_link}}');
        expect(() => renderTemplate(f, values)).not.toThrow();
        expect(f.toLowerCase()).not.toMatch(/legal notice|court|police|arrest/);
        for (const w of BANNED_WORDS.filter((x) => /^[a-z ]{4,}$/.test(x)))
          expect(f.toLowerCase()).not.toContain(w);
      }
      expect(FORMAL_TEMPLATES[stage].en).toMatch(/^Respected Sir\/Madam/);
    }
  });
  it('government buyers get formal email only, never WhatsApp', () => {
    const c = { entity_type: 'government', phone: '9999999999', opt_in_whatsapp: true } as never;
    expect(
      pickChannel({ ...(c as object), email: null } as never, ['email', 'whatsapp']).channel,
    ).toBeNull();
    expect(
      pickChannel({ ...(c as object), email: 'a@b.gov.in' } as never, ['email', 'whatsapp'])
        .channel,
    ).toBe('email');
  });
  it('next-steps guide adds the escalation line for government buyers only', () => {
    expect(nextStepsGuide(true, true).join(' ')).toContain('CPGRAMS');
    expect(nextStepsGuide(true).join(' ')).not.toContain('CPGRAMS');
  });
});
