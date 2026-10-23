import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '@/locales/en.json';
import hi from '@/locales/hi.json';
import mr from '@/locales/mr.json';

export const resources = {
  en: { translation: en },
  hi: { translation: hi },
  mr: { translation: mr },
} as const;

// English copy only for now; hi and mr fall back to English until translated.
void i18n.use(initReactI18next).init({
  resources,
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
