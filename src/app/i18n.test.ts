import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import en from '@/locales/en.json';
import hi from '@/locales/hi.json';
import mr from '@/locales/mr.json';
import { amountInWordsFor } from '@/lib/money';
import i18n, { LANGUAGES, tr } from './i18n';

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(d.name) && !/\.test\./.test(d.name) ? [p] : [];
  });
}

/** Every literal key passed to t() / tr() in the app. */
function keysInCode(): string[] {
  const keys = new Set<string>();
  for (const f of sourceFiles(path.resolve(__dirname, '..'))) {
    const src = fs.readFileSync(f, 'utf8');
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    (function walk(n: ts.Node) {
      if (ts.isCallExpression(n) && /^(t|i18n\.t)$/.test(n.expression.getText(sf))) {
        const a = n.arguments[0];
        if (a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a))) keys.add(a.text);
      }
      ts.forEachChild(n, walk);
    })(sf);
  }
  return [...keys].filter((k) => /[A-Za-z]{2}/.test(k));
}

const slots = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort().join(',');

describe('i18n', () => {
  it('every key used in the code has a Hindi and a Marathi translation', () => {
    const missing = (bundle: Record<string, string>) =>
      keysInCode().filter((k) => !bundle[k] && !(k in en && bundle[k] !== undefined));
    expect(missing(hi), 'missing in hi').toEqual([]);
    expect(missing(mr), 'missing in mr').toEqual([]);
  });

  it('every id key in en.json is translated and slots match', () => {
    for (const [k, v] of Object.entries(en)) {
      expect(hi[k as keyof typeof hi], `hi ${k}`).toBeTruthy();
      expect(mr[k as keyof typeof mr], `mr ${k}`).toBeTruthy();
      expect(slots(hi[k as keyof typeof hi] ?? ''), `hi slots ${k}`).toBe(slots(v));
      expect(slots(mr[k as keyof typeof mr] ?? ''), `mr slots ${k}`).toBe(slots(v));
    }
  });

  it('translations keep the same {{slots}} as the English key', () => {
    const bad: string[] = [];
    for (const [lang, bundle] of [
      ['hi', hi],
      ['mr', mr],
    ] as const) {
      for (const [k, v] of Object.entries(bundle as Record<string, string>)) {
        if (/^[a-z]+\.[A-Za-z.]+$/.test(k)) continue; // id keys are checked above
        if (slots(k) !== slots(v)) bad.push(`${lang}: ${k}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('language names are shown in their own script', () => {
    expect(LANGUAGES.map((l) => l.name)).toEqual(['English', 'हिन्दी', 'मराठी']);
  });

  it('switches language and interpolates', async () => {
    await i18n.changeLanguage('hi');
    expect(i18n.t('nav.today')).toBe('आज');
    expect(i18n.t('Issued {{number}}.', { number: 'INV/26-27/0001' })).toBe(
      'INV/26-27/0001 जारी हुआ।',
    );
    await i18n.changeLanguage('mr');
    expect(i18n.t('nav.today')).toBe('आज');
    await i18n.changeLanguage('en');
    expect(i18n.t('auth.codeSent', { email: 'a@b.in' })).toBe('We sent a code to a@b.in.');
  });

  it('sentences built in code are translated by pattern, piece by piece', async () => {
    await i18n.changeLanguage('hi');
    expect(tr('Line 2: description is required.')).toBe('पंक्ति 2: विवरण ज़रूरी है।');
    expect(tr('21 days overdue, usually pays 7 days late')).toBe(
      '21 दिन की देरी, आम तौर पर 7 दिन देर से चुकाता है',
    );
    expect(tr('27 Maharashtra')).toBe('27 महाराष्ट्र');
    // names of customers are data and stay as typed
    expect(tr('Delta Services LLP')).toBe('Delta Services LLP');
    await i18n.changeLanguage('en');
    expect(tr('Line 2: description is required.')).toBe('Line 2: description is required.');
  });

  it('amount in words in Hindi and Marathi', () => {
    expect(amountInWordsFor(11_800_00 as never, 'hi')).toBe('ग्यारह हज़ार आठ सौ रुपये मात्र');
    expect(amountInWordsFor(11_800_00 as never, 'mr')).toBe('अकरा हजार आठशे रुपये फक्त');
    expect(amountInWordsFor(10_000_000_50 as never, 'hi')).toBe(
      'एक करोड़ रुपये और पचास पैसे मात्र',
    );
    expect(amountInWordsFor(100_00 as never, 'mr')).toBe('शंभर रुपये फक्त');
    expect(amountInWordsFor(11_800_00 as never, 'en')).toBe(
      'Rupees Eleven Thousand Eight Hundred Only',
    );
  });
});
