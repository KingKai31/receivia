import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Input, Pager, ResponsiveTable, Select } from '@/components/ui';
import { useOrg } from '@/features/auth/useOrg';
import { listCustomers } from '@/features/customers/customerService';
import { formatINR, paise } from '@/lib/money';
import { can } from '@/lib/permissions';
import { PAGE_SIZE, errorMessage } from '@/lib/service/errors';
import { displayStatus, type DisplayStatus } from './invoiceModel';
import { listInvoices, type InvoiceListRow } from './invoiceService';

const STATUSES: DisplayStatus[] = [
  'draft',
  'issued',
  'due soon',
  'overdue',
  'part paid',
  'paid',
  'disputed',
];

export function InvoicesPage() {
  const org = useOrg();
  const orgId = org.data?.orgId;
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(0);
  const customerId = params.get('customer') ?? '';
  const status = (params.get('status') ?? '') as DisplayStatus | '';
  const dueFrom = params.get('dueFrom') ?? '';
  const dueTo = params.get('dueTo') ?? '';
  const overdue = params.get('overdue') ?? '';
  const search = params.get('q') ?? '';

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setPage(0);
  };

  const customers = useQuery({
    queryKey: ['customer-options', orgId, ''],
    enabled: Boolean(orgId),
    queryFn: () => listCustomers({ orgId: orgId!, pageSize: 200 }),
  });
  const q = useQuery({
    queryKey: ['invoices', orgId, customerId, status, dueFrom, dueTo, overdue, search, page],
    enabled: Boolean(orgId),
    placeholderData: (prev) => prev,
    queryFn: () =>
      listInvoices({
        orgId: orgId!,
        customerId: customerId || undefined,
        status,
        dueFrom: dueFrom || undefined,
        dueTo: dueTo || undefined,
        minDaysOverdue: overdue ? Number(overdue) : undefined,
        search,
        page,
      }),
  });

  return (
    <>
      <h1>Invoices</h1>
      {can.writeData(org.data?.role ?? null) ? (
        <p>
          <Link to="/invoices/new">New invoice</Link> · <Link to="/import">Import</Link>
        </p>
      ) : null}
      <div className="grid gap-3 md:grid-cols-3">
        <Input
          label="Search number or customer"
          type="search"
          value={search}
          onChange={(e) => set('q', e.target.value)}
        />
        <Select
          label="Customer"
          value={customerId}
          onChange={(e) => set('customer', e.target.value)}
          options={[
            { value: '', label: 'All customers' },
            ...(customers.data?.rows ?? []).map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
        <Select
          label="Status"
          value={status}
          onChange={(e) => set('status', e.target.value)}
          options={[{ value: '', label: 'All' }, ...STATUSES.map((s) => ({ value: s, label: s }))]}
        />
        <Input
          label="Due from"
          type="date"
          value={dueFrom}
          onChange={(e) => set('dueFrom', e.target.value)}
        />
        <Input
          label="Due to"
          type="date"
          value={dueTo}
          onChange={(e) => set('dueTo', e.target.value)}
        />
        <Select
          label="Days overdue"
          value={overdue}
          onChange={(e) => set('overdue', e.target.value)}
          options={[
            { value: '', label: 'Any' },
            { value: '1', label: '1 day or more' },
            { value: '30', label: '30 days or more' },
            { value: '60', label: '60 days or more' },
            { value: '90', label: '90 days or more' },
          ]}
        />
      </div>
      {q.error ? <p role="alert">{errorMessage(q.error)}</p> : null}
      {q.data ? (
        <>
          <ResponsiveTable<InvoiceListRow>
            caption="Invoices"
            rows={q.data.rows}
            rowKey={(r) => r.id}
            emptyText="No invoices match."
            columns={[
              {
                key: 'number',
                header: 'Number',
                render: (r) => <Link to={`/invoices/${r.id}`}>{r.number ?? 'Draft'}</Link>,
              },
              { key: 'customer', header: 'Customer', render: (r) => r.customers?.name ?? '—' },
              { key: 'date', header: 'Date', render: (r) => r.issue_date },
              { key: 'due', header: 'Due', render: (r) => r.due_date },
              { key: 'total', header: 'Total', render: (r) => formatINR(paise(r.total_paise)) },
              {
                key: 'balance',
                header: 'Balance',
                render: (r) => formatINR(paise(r.total_paise - r.paid_paise)),
              },
              {
                key: 'status',
                header: 'Status',
                render: (r) => (
                  <>
                    <Badge>{displayStatus(r)}</Badge>
                    {r.source === 'import' ? ' imported' : ''}
                  </>
                ),
              },
            ]}
          />
          <Pager page={page} pageSize={PAGE_SIZE} total={q.data.total} onPage={setPage} />
        </>
      ) : q.isLoading ? (
        <p>Loading…</p>
      ) : null}
    </>
  );
}
