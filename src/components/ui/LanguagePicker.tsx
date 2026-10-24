import { useTranslation } from 'react-i18next';
import { LANGUAGES, setLanguage, type AppLang } from '@/app/i18n';

/** Language names are shown in their own script, never translated. */
export function LanguagePicker() {
  const { t, i18n } = useTranslation();
  return (
    <div className="ui-field">
      <label htmlFor="app-language">{t('Language')}</label>
      <select
        id="app-language"
        className="ui-input"
        value={i18n.resolvedLanguage ?? 'en'}
        onChange={(e) => void setLanguage(e.target.value as AppLang)}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.name}
          </option>
        ))}
      </select>
    </div>
  );
}
