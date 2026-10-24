import { useTranslation } from 'react-i18next';

/** The one loading state: glass skeleton, announced to screen readers, never blank. */
export function Loading() {
  const { t } = useTranslation();
  return (
    <div role="status" aria-busy="true">
      <p className="sr-only">{t('Loading…')}</p>
      <div className="skeleton" style={{ minHeight: 160 }} aria-hidden="true" />
      <div className="skeleton" aria-hidden="true" />
      <div className="skeleton" aria-hidden="true" />
    </div>
  );
}
