import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Badge, Button, Card, ResponsiveTable, useToast } from '@/components/ui';
import { useOrg } from '@/features/auth/useOrg';
import { getCustomer } from '@/features/customers/customerService';
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

export function InvoiceDetailPage() {
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
      toast.show(`Issued ${r.number}.`);
      void qc.invalidateQueries({ queryKey: ['invoice', id] });
      void qc.invalidateQueries({ queryKey: ['timeline', id] });
      void qc.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (e) => toast.show(errorMessage(e)),
  });

  if (inv.isLoading) return <p>Loading…</p>;
  if (inv.error) return <p role="alert">{errorMessage(inv.error)}</p>;
  if (!inv.data) return null;
  const { invoice: i, lines } = inv.data;
  const balance = paise(i.balance_paise);

  return (
    <>
      <h1>{i.number ?? 'Draft invoice'}</h1>
      <p>
        <Badge>{displayStatus(i)}</Badge>
        {i.source === 'import' ? ' · imported' : ''}
      </p>
      <p className="flex flex-wrap gap-3">
        {i.status === 'draft' && writable ? (
          <>
            <Link to={`/invoices/${i.id}/edit`}>Edit draft</Link>
            <Button onClick={() => issue.mutate()} disabled={issue.isPending}>
              Issue invoice
            </Button>
          </>
        ) : null}
        <Link to={`/doc/invoice/${i.id}`}>Print view</Link>
        {i.status !== 'draft' && i.status !== 'void' && writable ? (
          <Link to={`/invoices/${i.id}/notes/new`}>Credit or debit note</Link>
        ) : null}
      </p>
      <Card>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt>Customer</dt>
          <dd>
            {customer.data ? (
              <Link to={`/customers/${customer.data.id}`}>{customer.data.name}</Link>
            ) : (
              '…'
            )}
          </dd>
          <dt>Invoice date</dt>
          <dd>{i.issue_date}</dd>
          <dt>Due date</dt>
          <dd>{i.due_date}</dd>
          <dt>Total</dt>
          <dd>{formatINR(paise(i.total_paise))}</dd>
          <dt>Paid</dt>
          <dd>{formatINR(paise(i.paid_paise))}</dd>
          {i.credited_paise > 0 ? (
            <>
              <dt>Credit notes</dt>
              <dd>{formatINR(paise(i.credited_paise))}</dd>
            </>
          ) : null}
          {i.tds_paise > 0 ? (
            <>
              <dt>TDS</dt>
              <dd>{formatINR(paise(i.tds_paise))}</dd>
            </>
          ) : null}
          <dt>Balance</dt>
          <dd>{formatINR(balance)}</dd>
        </dl>
      </Card>
      <h2>Lines</h2>
      <ResponsiveTable<InvoiceLine>
        caption="Invoice lines"
        rows={lines}
        rowKey={(l) => l.id}
        emptyText="This imported invoice has no line detail."
        columns={[
          { key: 'd', header: 'Description', render: (l) => l.description },
          { key: 'q', header: 'Qty', render: (l) => `${l.qty} ${l.unit ?? ''}` },
          { key: 'r', header: 'Rate', render: (l) => formatINR(paise(l.rate_paise)) },
          { key: 'g', header: 'GST', render: (l) => `${l.gst_rate}%` },
          { key: 't', header: 'Total', render: (l) => formatINR(paise(l.total_paise)) },
        ]}
      />
      <h2>Credit and debit notes</h2>
      <ResponsiveTable<Note>
        caption="Notes"
        rows={notes.data ?? []}
        rowKey={(n) => n.id}
        emptyText="No notes."
        columns={[
          {
            key: 'n',
            header: 'Number',
            render: (n) => <Link to={`/doc/note/${n.id}`}>{n.number ?? 'Draft'}</Link>,
          },
          { key: 't', header: 'Type', render: (n) => n.note_type },
          { key: 'a', header: 'Amount', render: (n) => formatINR(paise(n.total_paise)) },
          { key: 's', header: 'Status', render: (n) => n.status },
        ]}
      />
      <h2>Timeline</h2>
      <ol className="m-0 list-none p-0">
        {(timeline.data ?? []).map((e) => (
          <li key={e.id}>
            {new Date(e.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} —{' '}
            {describeTimelineEntry(e)}
          </li>
        ))}
        {timeline.data?.length === 0 ? <li>No history yet.</li> : null}
      </ol>
    </>
  );
}
