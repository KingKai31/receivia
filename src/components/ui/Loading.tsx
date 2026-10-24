import { useTranslation } from 'react-i18next';

/** The one loading state: announced to screen readers, never blank. */
export function Loading() {
  const { t } = useTranslation();
  return (
    <p role="status" aria-busy="true" className="ui-hint">
      {t('Loading…')}
    </p>
  );
}
