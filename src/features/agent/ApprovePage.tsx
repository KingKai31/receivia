import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button, Card } from '@/components/ui';
import { approveByToken } from './agentService';

/** Public page behind the "Approve all" link in the owner brief. The signed token is the credential. */
export function ApprovePage() {
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
        <h1>Approve reminders</h1>
        {!token || preview.isError ? (
          <p role="alert">This approval link is invalid or has expired.</p>
        ) : null}
        {preview.data && done === null ? (
          <>
            <p>
              {preview.data.business}: {preview.data.pending} message(s) planned for{' '}
              {preview.data.day} are waiting for approval.
              {preview.data.test_mode
                ? ' Test mode is on: they will be sent to the owner, not to customers.'
                : ''}
            </p>
            {(preview.data.pending ?? 0) > 0 ? (
              <Button disabled={approve.isPending} onClick={() => approve.mutate()}>
                {approve.isPending ? 'Approving…' : `Approve all ${preview.data.pending}`}
              </Button>
            ) : (
              <p>Nothing left to approve.</p>
            )}
            {approve.isError ? <p role="alert">Could not approve. Try again.</p> : null}
          </>
        ) : null}
        {done !== null ? (
          <p role="status">Approved {done} message(s). They are being sent.</p>
        ) : null}
      </Card>
    </main>
  );
}
