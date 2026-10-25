import { tr } from '@/app/i18n';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  HeroCard,
  Loading,
  MoneyTable,
  ResponsiveTable,
  Timeline,
  Title,
  Why,
  useToast,
} from '@/components/ui';
import { addDays, todayIST } from '@/lib/dates';
import { explainDaysOverdue, explainItc180, explainStoredInvoiceTotal } from '@/lib/explain';
import { useOrg } from '@/features/auth/useOrg';
import { getCustomer } from '@/features/customers/customerService';
import { isGovernmentPath } from '@/lib/legal/government';
import { BillRefField } from './BillRefField';
import { listNotesForInvoice, type Note } from '@/features/notes/noteService';
import { formatINR, paise } from '@/lib/money';
import { can } from '@/lib/permissions';
import { errorMessage } from '@/lib/service/errors';
import { displayStatus } from './invoiceModel';
import {
  describeTimelineEntry,
  getInvoice,
  invoiceTimeline,
  issueInvoice,
  type InvoiceLine,
} from './invoiceService';

const money = (n: number) => formatINR(paise(n));
const invoiceSource = (i: { id: string; number: string | null }) => ({
  label: `Invoice ${i.number ?? 'draft'}`,
  href: `/invoices/${i.id}`,
});

export function InvoiceDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const org = useOrg();
  const writable = can.writeData(org.data?.role ?? null);
  const qc = useQueryClient();
  const toast = useToast();
  const inv = useQuery({ queryKey: ['invoice', id], queryFn: () => getInvoice(id!) });
  const customer = useQuery({
    queryKey: ['customer', inv.data?.invoice.customer_id],
    enabled: Boolean(inv.data),
    queryFn: () => getCustomer(inv.data!.invoice.customer_id),
  });
  const timeline = useQuery({ queryKey: ['timeline', id], queryFn: () => invoiceTimeline(id!) });
  const notes = useQuery({ queryKey: ['notes', id], queryFn: () => listNotesForInvoice(id!) });
  const issue = useMutation({
    mutationFn: () => issueInvoice(inv.data!.invoice),
    onSuccess: (r) => {
      toast.show(t('Issued {{number}}.', { number: r.number }));
      void qc.invalidateQueries({ queryKey: ['invoice', id] });
      void qc.invalidateQueries({ queryKey: ['timeline', id] });
      void qc.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (e) => toast.show(errorMessage(e)),
  });

  if (inv.isLoading) return <Loading />;
  if (inv.error) return <p role="alert">{errorMessage(inv.error)}</p>;
  if (!inv.data) return null;
  const { invoice: i, lines } = inv.data;
  const balance = paise(i.balance_paise);
  const title = i.number ?? t('Draft invoice');

  return (
    <>
      <h1 className="sr-only">{title}</h1>
      <HeroCard
        label={`${title} · ${t('Balance')}`}
        value={balance}
        format={money}
        sub={
          <>
            <Badge>{displayStatus(i)}</Badge>
            {i.source === 'import' ? t(' · imported') : ''}
          </>
        }
      >
        <div className="hero-actions">
          {i.status === 'draft' && writable ? (
            <>
              <ButtonLink to={`/invoices/${i.id}/edit`} variant="light">
                {t('Edit draft')}
              </ButtonLink>
              <Button variant="dark" onClick={() => issue.mutate()} disabled={issue.isPending}>
                {t('Issue invoice')}
              </Button>
            </>
          ) : null}
          <ButtonLink to={`/doc/invoice/${i.id}`} variant="light">
            {t('Print view')}
          </ButtonLink>
          {i.status !== 'draft' && i.status !== 'void' && writable ? (
            <ButtonLink to={`/invoices/${i.id}/notes/new`} variant="dark">
              {t('Credit or debit note')}
            </ButtonLink>
          ) : null}
        </div>
      </HeroCard>
      <div className="grid-2">
        <Card>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt>{t('Customer')}</dt>
            <dd>
              {customer.data ? (
                <Link to={`/customers/${customer.data.id}`}>{customer.data.name}</Link>
              ) : (
                '…'
              )}
            </dd>
            <dt>{t('Invoice date')}</dt>
            <dd className="num">{i.issue_date}</dd>
            <dt>{t('Due date')}</dt>
            <dd className="num">
              {i.due_date}
              {i.balance_paise > 0 && i.due_date < todayIST() ? (
                <Why
                  explain={() => explainDaysOverdue(i.due_date, todayIST(), [invoiceSource(i)])}
                />
              ) : null}
            </dd>
            {i.status !== 'draft' && i.balance_paise > 0 ? (
              <>
                <dt>{t('180-day ITC date')}</dt>
                <dd className="num">
                  {addDays(i.issue_date, 180)}
                  <Why
                    explain={() => explainItc180(i.issue_date, todayIST(), [invoiceSource(i)])}
                  />
                </dd>
              </>
            ) : null}
          </dl>
        </Card>
        <MoneyTable
          lines={[
            {
              label: t('Total'),
              amount: (
                <>
                  {money(i.total_paise)}
                  <Why explain={() => explainStoredInvoiceTotal(i, [invoiceSource(i)])} />
                </>
              ),
            },
            { label: t('Paid'), amount: money(i.paid_paise) },
            ...(i.credited_paise > 0
              ? [{ label: t('Credit notes'), amount: money(i.credited_paise) }]
              : []),
            ...(i.tds_paise > 0 ? [{ label: t('TDS'), amount: money(i.tds_paise) }] : []),
            { label: t('Balance'), amount: money(balance) },
          ]}
        />
      </div>
      <Title>{t('Lines')}</Title>
      <ResponsiveTable<InvoiceLine>
        caption={t('Invoice lines')}
        rows={lines}
        rowKey={(l) => l.id}
        emptyText="This imported invoice has no line detail."
        columns={[
          { key: 'd', header: 'Description', render: (l) => l.description },
          {
            key: 'q',
            header: 'Qty',
            render: (l) => t('{{qty}} {{v}}', { qty: l.qty, v: l.unit ?? '' }),
          },
          { key: 'r', header: 'Rate', render: (l) => formatINR(paise(l.rate_paise)) },
          { key: 'g', header: 'GST', render: (l) => `${l.gst_rate}%` },
          { key: 't', header: 'Total', render: (l) => formatINR(paise(l.total_paise)) },
        ]}
      />
      {customer.data && isGovernmentPath(customer.data) ? (
        <BillRefField
          invoiceId={i.id}
          value={(i as { bill_ref?: string | null }).bill_ref ?? null}
          writable={writable}
        />
      ) : null}
      <Title>{t('Credit and debit notes')}</Title>
      <ResponsiveTable<Note>
        caption={t('Notes')}
        rows={notes.data ?? []}
        rowKey={(n) => n.id}
        emptyText="No notes."
        columns={[
          {
            key: 'n',
            header: 'Number',
            render: (n) => <Link to={`/doc/note/${n.id}`}>{n.number ?? t('Draft')}</Link>,
          },
          { key: 't', header: 'Type', render: (n) => n.note_type },
          { key: 'a', header: 'Amount', render: (n) => formatINR(paise(n.total_paise)) },
          { key: 's', header: 'Status', render: (n) => n.status },
        ]}
      />
      <Title>{t('Timeline')}</Title>
      {timeline.data?.length === 0 ? (
        <Card>{t('No history yet.')}</Card>
      ) : (
        <Timeline
          label={t('Timeline')}
          steps={(timeline.data ?? []).map((e) => ({
            key: e.id,
            title: tr(describeTimelineEntry(e)),
            time: new Date(e.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
          }))}
        />
      )}
    </>
  );
}
