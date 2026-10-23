import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/ui';

/** Placeholder body for screens built in later sessions. */
export function StubPage({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return (
    <>
      <h1>{t(titleKey)}</h1>
      <EmptyState title={t('pages.emptyTitle')} description={t('pages.comingSoon')} />
    </>
  );
}
