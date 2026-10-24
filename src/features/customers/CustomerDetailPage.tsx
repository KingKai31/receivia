import { tr } from '@/app/i18n';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Card, Loading, ResponsiveTable } from '@/components/ui';
import { formatINR, paise } from '@/lib/money';
import { errorMessage } from '@/lib/service/errors';
import { ConsentCard } from '@/features/privacy/ConsentCard';
import { customerSummary, getCustomer, type CustomerPayment } from './customerService';

export function CustomerDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const customer = useQuery({ queryKey: ['customer', id], queryFn: () => getCustomer(id!) });
  const summary = useQuery({
    queryKey: ['customer-summary', id],
    queryFn: () => customerSummary(id!),
  });
  if (customer.isLoading) return <Loading />;
  if (customer.error) return <p role="alert">{errorMessage(customer.error)}</p>;
  const c = customer.data;
  if (!c) return null;
  return (
    <>
      <h1>{c.name}</h1>
      <p>
        <Link to={`/customers/${c.id}/edit`}>{t('Edit')}</Link> {t('·')}{' '}
        <Link to={`/invoices?customer=${c.id}`}>{t('Invoices')}</Link>
      </p>
      <Card>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt>{t('GSTIN')}</dt>
          <dd>{c.gstin ?? '—'}</dd>
          <dt>{t('Credit days')}</dt>
          <dd>{c.credit_days}</dd>
          <dt>{t('Tier')}</dt>
          <dd>{tr(c.tier)}</dd>
          <dt>{t('Entity type')}</dt>
          <dd>{c.entity_type ? tr(c.entity_type) : '—'}</dd>
          <dt>{t('Written agreement')}</dt>
          <dd>{c.has_written_agreement ? t('Yes') : t('No')}</dd>
          <dt>{t('Presumptive tax')}</dt>
          <dd>{tr(c.presumptive_tax)}</dd>
          <dt>{t('WhatsApp')}</dt>
          <dd>{c.opt_in_whatsapp ? t('Agreed') : t('Not agreed')}</dd>
        </dl>
      </Card>
      <ConsentCard customerId={c.id} />
      <Card>
        <h2>{t('Total owed')}</h2>
        {summary.data ? (
          <p>
            <strong>{formatINR(paise(summary.data.owed))}</strong> {t('across')}{' '}
            {t('{{openInvoices}} open invoice(s)', { openInvoices: summary.data.openInvoices })}
          </p>
        ) : (
          <Loading />
        )}
      </Card>
      <h2>{t('Payment record')}</h2>
      <ResponsiveTable<CustomerPayment>
        caption={t('Payments received')}
        rows={summary.data?.payments ?? []}
        rowKey={(p) => p.id}
        emptyText="No payments recorded yet."
        columns={[
          { key: 'date', header: 'Date', render: (p) => p.received_on },
          { key: 'amt', header: 'Amount', render: (p) => formatINR(paise(p.amount_paise)) },
          { key: 'method', header: 'Method', render: (p) => tr(p.method) },
          { key: 'ref', header: 'Reference', render: (p) => p.reference ?? '—' },
          { key: 'status', header: 'Status', render: (p) => tr(p.status) },
        ]}
      />
    </>
  );
}
