import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '@/locales/en.json';

/** English ships in the main bundle; Hindi and Marathi load on demand (about 60 KB each). */
const loaders: Record<string, () => Promise<{ default: Record<string, string> }>> = {
  hi: () => import('@/locales/hi.json'),
  mr: () => import('@/locales/mr.json'),
};
async function ensureLang(code: string): Promise<void> {
  const load = loaders[code];
  if (!load || i18n.hasResourceBundle(code, 'translation')) return;
  i18n.addResourceBundle(code, 'translation', (await load()).default);
}

/** Names are written in their own script so anyone can find their language. */
export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'mr', name: 'मराठी' },
] as const;
export type AppLang = (typeof LANGUAGES)[number]['code'];

const STORE_KEY = 'receivia.lang';

function stored(): AppLang {
  try {
    const v = window.localStorage.getItem(STORE_KEY);
    if (v === 'hi' || v === 'mr' || v === 'en') return v;
  } catch {
    /* storage blocked */
  }
  return 'en';
}

type Bundle = Record<string, string>;
const patternCache = new Map<string, [RegExp, string, string[]][]>();

function patternsFor(lng: string): [RegExp, string, string[]][] {
  let list = patternCache.get(lng);
  if (!list) {
    const bundle = (i18n.getResourceBundle(lng, 'translation') ?? {}) as Bundle;
    list = Object.entries(bundle)
      .filter(
        ([k, v]) =>
          k.includes('{{') && v && k.replace(/\{\{\w+\}\}|[\s·:,.()–—%-]/g, '').length >= 4,
      )
      .map(([k, v]): [RegExp, string, string[], number] => {
        const names: string[] = [];
        const src = k
          .split(/\{\{(\w+)\}\}/)
          .map((part, i) => {
            if (i % 2 === 1) {
              names.push(part);
              return '([\\s\\S]+?)';
            }
            return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          })
          .join('');
        return [new RegExp(`^${src}$`), v, names, k.replace(/\{\{\w+\}\}/g, '').length];
      })
      .sort((x, y) => y[3] - x[3])
      .map(([re, v, names]) => [re, v, names] as [RegExp, string, string[]]);
    patternCache.set(lng, list);
  }
  return list;
}

/** Messages built in code with numbers in them (e.g. "Line 2: description is required.") match a {{slot}} key. */
function translatePattern(message: string): string {
  const lng = i18n.language ?? 'en';
  if (lng === 'en') return message;
  for (const [re, tpl, names] of patternsFor(lng)) {
    const m = re.exec(message);
    if (m && m.slice(1).join('').length <= message.length * 0.6)
      return tpl.replace(/\{\{(\w+)\}\}/g, (_, n: string) => {
        const raw = m[names.indexOf(n) + 1] ?? '';
        return raw.length > 2 && /[A-Za-z]{3}/.test(raw) ? i18n.t(raw) : raw;
      });
  }
  return message;
}

// The English sentence is the key (keys with a dot and no English text are the older ids).
// A missing translation shows the English text, and src/app/i18n.test.ts fails if one is missing.
// Runs on every lookup; only acts when the key has no translation (a sentence built in code).
const patternProcessor = {
  type: 'postProcessor' as const,
  name: 'patterns',
  process: (value: string, key: string | string[]) => {
    const k = Array.isArray(key) ? key[0]! : key;
    return i18n.exists(k) ? value : translatePattern(value);
  },
};

void i18n
  .use(patternProcessor)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en } },
    lng: 'en',
    fallbackLng: 'en',
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
    postProcess: ['patterns'],
  });

function syncDocument(lng: string) {
  if (typeof document !== 'undefined') document.documentElement.lang = lng;
}
const originalChange = i18n.changeLanguage.bind(i18n);
i18n.changeLanguage = async (lng, callback) => {
  if (lng) await ensureLang(lng);
  return originalChange(lng, callback);
};
if (typeof window !== 'undefined' && stored() !== 'en') void i18n.changeLanguage(stored());
syncDocument(i18n.language);
i18n.on('languageChanged', syncDocument);

export function setLanguage(code: AppLang): Promise<unknown> {
  try {
    window.localStorage.setItem(STORE_KEY, code);
  } catch {
    /* storage blocked */
  }
  return i18n.changeLanguage(code);
}

export default i18n;

/**
 * Translates a sentence built in code. Tries the whole text first (exact or {{slot}} key); if
 * that has no translation, translates it piece by piece (split at "; ", ". " and ", ") so that
 * lists of facts such as "21 days overdue, usually pays 7 days late" come out in the language.
 */
export function tr(text: string): string {
  if (!text || i18n.language === 'en') return text;
  const whole = i18n.t(text);
  if (whole !== text) return whole;
  const state = /^(\d{2}) (.+)$/.exec(text);
  if (state && i18n.exists(state[2]!)) return `${state[1]} ${i18n.t(state[2]!)}`;
  const parts = text.split(/(; |\. |, )/);
  if (parts.length === 1) return text;
  return parts
    .map((p, i) => {
      if (i % 2 === 1 || !p) return p;
      const direct = i18n.t(p);
      if (direct !== p) return direct;
      const dotted = i18n.t(`${p}.`);
      return dotted !== `${p}.` ? dotted.replace(/[.।]$/, '') : p;
    })
    .join('');
}
