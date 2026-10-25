import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, Input, Loading, useToast } from '@/components/ui';
import { ReplyBox } from '@/features/ai/ReplyBox';
import { useOrg } from '@/features/auth/useOrg';
import { formatINR, paise } from '@/lib/money';
import { errorMessage } from '@/lib/service/errors';
import {
  loadInbox,
  resolveClaim,
  resolveDispute,
  setPromiseStatus,
  type ClaimItem,
  type DisputeItem,
  type PromiseItem,
} from './inboxService';

const STEP = 25;

function InvoiceLine({
  id,
  inv,
  customer,
}: {
  id: string;
  inv: { number: string | null; balance_paise: number } | null;
  customer: string;
}) {
  const { t } = useTranslation();
  return (
    <p>
      <strong>{customer}</strong> {t('·')}{' '}
      <Link to={`/invoices/${id}`}>{inv?.number ?? t('Invoice')}</Link>{' '}
      {t('· balance {{formatINR}}', { formatINR: formatINR(paise(inv?.balance_paise ?? 0)) })}
    </p>
  );
}

function ClaimCard({ item, orgId, done }: { item: ClaimItem; orgId: string; done: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [reply, setReply] = useState('');
  const m = useMutation({
    mutationFn: (accept: boolean) => resolveClaim({ orgId, claimId: item.id, accept, reply }),
    onSuccess: done,
    onError: (e) => toast.show(errorMessage(e)),
  });
  return (
    <Card>
      <InvoiceLine
        id={item.invoice_id}
        inv={item.invoices}
        customer={item.customers?.name ?? t('Customer')}
      />
      <p>
        {t('Says they paid on')} {item.paid_on ?? 'an unknown date'}
        {item.reference ? t(', reference {{reference}}', { reference: item.reference }) : ''}
        {t('.')}
      </p>
      <Input
        label={t('Reply to the buyer (required to reject)')}
        value={reply}
        onChange={(e) => setReply(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button disabled={m.isPending} onClick={() => m.mutate(true)}>
          {t('Accept: mark paid')}
        </Button>
        <Button
          variant="secondary"
          disabled={m.isPending || !reply.trim()}
          onClick={() => m.mutate(false)}
        >
          {t('Reject with reply')}
        </Button>
      </div>
    </Card>
  );
}

function DisputeCard({
  item,
  orgId,
  done,
}: {
  item: DisputeItem;
  orgId: string;
  done: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const nav = useNavigate();
  const [reply, setReply] = useState('');
  const m = useMutation({
    mutationFn: (outcome: 'credit_note' | 'paid' | 'rejected') =>
      resolveDispute({ orgId, disputeId: item.id, outcome, reply }).then(() => outcome),
    onSuccess: (outcome) => {
      done();
      if (outcome === 'credit_note') nav(`/invoices/${item.invoice_id}/notes/new`);
    },
    onError: (e) => toast.show(errorMessage(e)),
  });
  return (
    <Card>
      <InvoiceLine
        id={item.invoice_id}
        inv={item.invoices}
        customer={item.customers?.name ?? t('Customer')}
      />
      <p>
        {t('Dispute ({{raised_via}}): {{reason}}', {
          raised_via: item.raised_via,
          reason: item.reason,
        })}
      </p>
      <Input
        label={t('Reply to the buyer (required to reject)')}
        value={reply}
        onChange={(e) => setReply(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button disabled={m.isPending} onClick={() => m.mutate('credit_note')}>
          {t('Accept: issue credit note')}
        </Button>
        <Button variant="secondary" disabled={m.isPending} onClick={() => m.mutate('paid')}>
          {t('Accept: mark paid')}
        </Button>
        <Button
          variant="secondary"
          disabled={m.isPending || !reply.trim()}
          onClick={() => m.mutate('rejected')}
        >
          {t('Reject with reply')}
        </Button>
        <Link to={`/invoices/${item.invoice_id}`}>{t('Open invoice')}</Link>
      </div>
    </Card>
  );
}

function PromiseCard({ item, done }: { item: PromiseItem; done: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const m = useMutation({
    mutationFn: (s: 'kept' | 'broken' | 'cancelled') => setPromiseStatus(item, s),
    onSuccess: done,
    onError: (e) => toast.show(errorMessage(e)),
  });
  return (
    <Card>
      <InvoiceLine
        id={item.invoice_id}
        inv={item.invoices}
        customer={item.customers?.name ?? t('Customer')}
      />
      <p>
        {t('Promised to pay on {{promised_for}} ({{source}}). Reminders are paused until then.', {
          promised_for: item.promised_for,
          source: item.source,
        })}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={m.isPending} onClick={() => m.mutate('kept')}>
          {t('Paid as promised')}
        </Button>
        <Button variant="secondary" disabled={m.isPending} onClick={() => m.mutate('broken')}>
          {t('Not paid: resume reminders')}
        </Button>
        <Button variant="secondary" disabled={m.isPending} onClick={() => m.mutate('cancelled')}>
          {t('Cancel promise')}
        </Button>
      </div>
    </Card>
  );
}

export function InboxPage() {
  const { t } = useTranslation();
  const org = useOrg();
  const orgId = org.data?.orgId;
  const qc = useQueryClient();
  const [limit, setLimit] = useState(STEP);
  const q = useQuery({
    queryKey: ['inbox', orgId, limit],
    enabled: Boolean(orgId),
    queryFn: () => loadInbox(orgId!, limit),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['inbox'] });
    void qc.invalidateQueries({ queryKey: ['collect-today'] });
    void qc.invalidateQueries({ queryKey: ['inbox-count'] });
  };
  const d = q.data;
  const more =
    d && (d.disputes.length >= limit || d.claims.length >= limit || d.promises.length >= limit);
  return (
    <>
      <h1>{t('Inbox')}</h1>
      <ReplyBox />
      <p>{t('What buyers have told you through the pay page or that you have logged.')}</p>
      {q.isLoading ? <Loading /> : null}
      {q.error ? <p role="alert">{errorMessage(q.error)}</p> : null}
      {d ? (
        <>
          <h2>{t('Already paid ({{length}})', { length: d.claims.length })}</h2>
          {d.claims.length === 0 ? <p>{t('Nothing waiting.')}</p> : null}
          {d.claims.map((c) => (
            <ClaimCard key={c.id} item={c} orgId={orgId!} done={refresh} />
          ))}
          <h2>{t('Disputes ({{length}})', { length: d.disputes.length })}</h2>
          {d.disputes.length === 0 ? <p>{t('Nothing waiting.')}</p> : null}
          {d.disputes.map((x) => (
            <DisputeCard key={x.id} item={x} orgId={orgId!} done={refresh} />
          ))}
          <h2>{t('Promises to pay ({{length}})', { length: d.promises.length })}</h2>
          {d.promises.length === 0 ? <p>{t('Nothing waiting.')}</p> : null}
          {d.promises.map((p) => (
            <PromiseCard key={p.id} item={p} done={refresh} />
          ))}
          {more ? (
            <Button variant="secondary" onClick={() => setLimit(limit + STEP)}>
              {t('Show more')}
            </Button>
          ) : null}
        </>
      ) : null}
    </>
  );
}
