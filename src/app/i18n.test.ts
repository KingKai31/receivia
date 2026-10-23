import { describe, expect, it } from 'vitest';
import i18n from './i18n';

describe('i18n', () => {
  it('hi and mr fall back to English', async () => {
    await i18n.changeLanguage('hi');
    expect(i18n.t('nav.today')).toBe('Today');
    await i18n.changeLanguage('mr');
    expect(i18n.t('nav.today')).toBe('Today');
    await i18n.changeLanguage('en');
  });
  it('interpolates', () => {
    expect(i18n.t('auth.codeSent', { email: 'a@b.in' })).toBe('We sent a code to a@b.in.');
  });
});
