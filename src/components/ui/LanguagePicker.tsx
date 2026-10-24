import { useTranslation } from 'react-i18next';
import { LANGUAGES, setLanguage, type AppLang } from '@/app/i18n';

const SHORT: Record<AppLang, string> = { en: 'EN', hi: 'हि', mr: 'मरा' };

/** EN · हि · मरा switcher. Language names stay in their own script, never translated. */
export function LanguagePicker() {
  const { t, i18n } = useTranslation();
  const current = i18n.resolvedLanguage ?? 'en';
  return (
    <div role="group" aria-label={t('Language')} className="chip-group glass">
      {LANGUAGES.map((l) => (
        <button
          key={l.code}
          type="button"
          className="chip-btn"
          lang={l.code}
          aria-label={l.name}
          aria-pressed={current === l.code}
          onClick={() => void setLanguage(l.code)}
        >
          {SHORT[l.code]}
        </button>
      ))}
    </div>
  );
}
