-- S5 forecast: opening balance and buffer, expense kinds and deferrable bills, settlement history view.

alter table public.business_profile
  add column opening_balance_paise bigint not null default 0,
  add column opening_balance_on date,
  add column safety_buffer_paise bigint not null default 0 check (safety_buffer_paise >= 0);

alter table public.expenses
  add column kind text not null default 'other'
    check (kind in ('salary', 'rent', 'tax', 'supplier', 'utility', 'other')),
  add column deferrable boolean not null default false;

create index expenses_org_active_idx on public.expenses (org_id, active) where active;

-- One row per payment applied to an invoice, with the invoice facts the delay model and the backtest
-- need. security_invoker so the caller's RLS on invoices, allocations and payments applies.
create view public.invoice_settlements with (security_invoker = true) as
  select i.org_id,
         i.id as invoice_id,
         i.customer_id,
         i.issue_date,
         i.due_date,
         i.total_paise,
         p.received_on as event_date,
         a.amount_paise as event_paise
    from public.allocations a
    join public.invoices i on i.id = a.invoice_id and i.org_id = a.org_id
    join public.payments p on p.id = a.payment_id and p.org_id = a.org_id
   where p.status = 'confirmed';

grant select on public.invoice_settlements to authenticated;
