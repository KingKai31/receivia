import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Card, ResponsiveTable } from '@/components/ui';
import { formatINR, paise } from '@/lib/money';
import { errorMessage } from '@/lib/service/errors';
import { customerSummary, getCustomer, type CustomerPayment } from './customerService';

export function CustomerDetailPage() {
  const { id } = useParams();
  const customer = useQuery({ queryKey: ['customer', id], queryFn: () => getCustomer(id!) });
  const summary = useQuery({
    queryKey: ['customer-summary', id],
    queryFn: () => customerSummary(id!),
  });
  if (customer.isLoading) return <p>Loading…</p>;
  if (customer.error) return <p role="alert">{errorMessage(customer.error)}</p>;
  const c = customer.data;
  if (!c) return null;
  return (
    <>
      <h1>{c.name}</h1>
      <p>
        <Link to={`/customers/${c.id}/edit`}>Edit</Link> ·{' '}
        <Link to={`/invoices?customer=${c.id}`}>Invoices</Link>
      </p>
      <Card>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt>GSTIN</dt>
          <dd>{c.gstin ?? '—'}</dd>
          <dt>Credit days</dt>
          <dd>{c.credit_days}</dd>
          <dt>Tier</dt>
          <dd>{c.tier}</dd>
          <dt>Entity type</dt>
          <dd>{c.entity_type ?? '—'}</dd>
          <dt>Written agreement</dt>
          <dd>{c.has_written_agreement ? 'Yes' : 'No'}</dd>
          <dt>Presumptive tax</dt>
          <dd>{c.presumptive_tax}</dd>
          <dt>WhatsApp</dt>
          <dd>{c.opt_in_whatsapp ? 'Agreed' : 'Not agreed'}</dd>
        </dl>
      </Card>
      <Card>
        <h2>Total owed</h2>
        {summary.data ? (
          <p>
            <strong>{formatINR(paise(summary.data.owed))}</strong> across{' '}
            {summary.data.openInvoices} open invoice(s)
          </p>
        ) : (
          <p>Loading…</p>
        )}
      </Card>
      <h2>Payment record</h2>
      <ResponsiveTable<CustomerPayment>
        caption="Payments received"
        rows={summary.data?.payments ?? []}
        rowKey={(p) => p.id}
        emptyText="No payments recorded yet."
        columns={[
          { key: 'date', header: 'Date', render: (p) => p.received_on },
          { key: 'amt', header: 'Amount', render: (p) => formatINR(paise(p.amount_paise)) },
          { key: 'method', header: 'Method', render: (p) => p.method },
          { key: 'ref', header: 'Reference', render: (p) => p.reference ?? '—' },
          { key: 'status', header: 'Status', render: (p) => p.status },
        ]}
      />
    </>
  );
}
