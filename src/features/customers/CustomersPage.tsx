import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Input, Pager, ResponsiveTable } from '@/components/ui';
import { useOrg } from '@/features/auth/useOrg';
import { can } from '@/lib/permissions';
import { PAGE_SIZE, errorMessage } from '@/lib/service/errors';
import { listCustomers, type Customer } from './customerService';

export function CustomersPage() {
  const org = useOrg();
  const orgId = org.data?.orgId;
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const q = useQuery({
    queryKey: ['customers', orgId, search, page],
    enabled: Boolean(orgId),
    placeholderData: (prev) => prev,
    queryFn: () => listCustomers({ orgId: orgId!, search, page }),
  });
  return (
    <>
      <h1>Customers</h1>
      <div className="flex flex-wrap items-end gap-3">
        <Input
          label="Search by name, GSTIN or phone"
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
        {can.writeData(org.data?.role ?? null) ? (
          <Link to="/customers/new">Add customer</Link>
        ) : null}
      </div>
      {q.error ? <p role="alert">{errorMessage(q.error)}</p> : null}
      {q.data ? (
        <>
          <ResponsiveTable<Customer>
            caption="Customers"
            rows={q.data.rows}
            rowKey={(c) => c.id}
            emptyText="No customers found."
            columns={[
              {
                key: 'name',
                header: 'Name',
                render: (c) => <Link to={`/customers/${c.id}`}>{c.name}</Link>,
              },
              { key: 'gstin', header: 'GSTIN', render: (c) => c.gstin ?? '—' },
              { key: 'tier', header: 'Tier', render: (c) => <Badge>{c.tier}</Badge> },
              { key: 'days', header: 'Credit days', render: (c) => String(c.credit_days) },
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
