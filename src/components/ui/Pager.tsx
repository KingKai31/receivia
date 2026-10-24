import { useTranslation } from 'react-i18next';
import { Button } from './Button';

export interface PagerProps {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}

/** Previous / next with a "from to of total" label. Pages are zero-based. */
export function Pager({ page, pageSize, total, onPage }: PagerProps) {
  const { t } = useTranslation();
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <nav aria-label={t('Pagination')} className="mt-3 flex items-center gap-3">
      <Button variant="secondary" disabled={page <= 0} onClick={() => onPage(page - 1)}>
        {t('Previous')}
      </Button>
      <span>{t('{{from}}–{{to}} of {{total}}', { from, to, total })}</span>
      <Button variant="secondary" disabled={to >= total} onClick={() => onPage(page + 1)}>
        {t('Next')}
      </Button>
    </nav>
  );
}
