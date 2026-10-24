import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button, Card } from '@/components/ui';
import { approveByToken } from './agentService';

/** Public page behind the "Approve all" link in the owner brief. The signed token is the credential. */
export function ApprovePage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('t') ?? '';
  const [done, setDone] = useState<number | null>(null);
  const preview = useQuery({
    queryKey: ['approve-preview', token],
    enabled: token !== '',
    retry: false,
    queryFn: () => approveByToken(token, false),
  });
  const approve = useMutation({
    mutationFn: () => approveByToken(token, true),
    onSuccess: (r) => setDone(r.approved ?? 0),
  });
  return (
    <main className="mx-auto max-w-xl p-4">
      <Card>
        <h1>{t('Approve reminders')}</h1>
        {!token || preview.isError ? (
          <p role="alert">{t('This approval link is invalid or has expired.')}</p>
        ) : null}
        {preview.data && done === null ? (
          <>
            <p>
              {t('{{business}}: {{pending}} message(s) planned for', {
                business: preview.data.business,
                pending: preview.data.pending,
              })}{' '}
              {t('{{day}} are waiting for approval.', { day: preview.data.day })}
              {preview.data.test_mode
                ? t(' Test mode is on: they will be sent to the owner, not to customers.')
                : ''}
            </p>
            {(preview.data.pending ?? 0) > 0 ? (
              <Button disabled={approve.isPending} onClick={() => approve.mutate()}>
                {approve.isPending
                  ? t('Approving…')
                  : t('Approve all {{pending}}', { pending: preview.data.pending })}
              </Button>
            ) : (
              <p>{t('Nothing left to approve.')}</p>
            )}
            {approve.isError ? <p role="alert">{t('Could not approve. Try again.')}</p> : null}
          </>
        ) : null}
        {done !== null ? (
          <p role="status">{t('Approved {{done}} message(s). They are being sent.', { done })}</p>
        ) : null}
      </Card>
    </main>
  );
}
