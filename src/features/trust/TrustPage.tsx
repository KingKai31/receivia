import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/ui';

export function TrustPage() {
  const { t } = useTranslation();
  return (
    <main className="mx-auto max-w-xl p-4">
      <h1>{t('pages.trust')}</h1>
      <EmptyState title={t('pages.emptyTitle')} description={t('pages.comingSoon')} />
    </main>
  );
}
