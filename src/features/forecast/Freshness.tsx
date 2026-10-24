import { useTranslation } from 'react-i18next';

/** "Last updated" line; says so when the numbers are the copy saved on this device. */
export function Freshness({ updatedAt, offline }: { updatedAt: number | null; offline: boolean }) {
  const { t, i18n } = useTranslation();
  if (!updatedAt) return null;
  const when = new Date(updatedAt).toLocaleString(`${i18n.language}-IN`, {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  return (
    <p className="ui-hint" role={offline ? 'status' : undefined}>
      {offline
        ? t('You are offline. Showing the copy saved on this device, last updated {{when}} IST.', {
            when,
          })
        : t('Last updated {{when}} IST.', { when })}
    </p>
  );
}
