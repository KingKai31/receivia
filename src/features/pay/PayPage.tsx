import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { EmptyState } from '@/components/ui';

/** Public buyer pay page. The token is resolved server-side in S4; it is never logged here. */
export function PayPage() {
  const { t } = useTranslation();
  const { token } = useParams<{ token: string }>();
  return (
    <main className="mx-auto max-w-xl p-4" data-has-token={token ? 'yes' : 'no'}>
      <h1>{t('pages.pay')}</h1>
      <EmptyState title={t('pages.emptyTitle')} description={t('pages.comingSoon')} />
    </main>
  );
}
