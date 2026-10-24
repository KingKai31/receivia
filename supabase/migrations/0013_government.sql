-- S13: government / PSU buyer path.
alter table public.customers add column if not exists is_psu boolean not null default false;
alter table public.invoices add column if not exists bill_ref text check (bill_ref is null or length(bill_ref) <= 60);
