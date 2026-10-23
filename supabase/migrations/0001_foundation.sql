-- Receivia 0001: multi-tenant foundation.
-- Orgs, memberships, roles, business data, RLS on every table, audit log, invoice counters.

create schema if not exists app;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Reference data (no org_id; read-only for signed-in users)
-- ---------------------------------------------------------------------------
create table public.gst_states (
  code char(2) primary key check (code ~ '^[0-9]{2}$'),
  name text not null
);

insert into public.gst_states (code, name) values
  ('01','Jammu and Kashmir'),('02','Himachal Pradesh'),('03','Punjab'),('04','Chandigarh'),
  ('05','Uttarakhand'),('06','Haryana'),('07','Delhi'),('08','Rajasthan'),('09','Uttar Pradesh'),
  ('10','Bihar'),('11','Sikkim'),('12','Arunachal Pradesh'),('13','Nagaland'),('14','Manipur'),
  ('15','Mizoram'),('16','Tripura'),('17','Meghalaya'),('18','Assam'),('19','West Bengal'),
  ('20','Jharkhand'),('21','Odisha'),('22','Chhattisgarh'),('23','Madhya Pradesh'),('24','Gujarat'),
  ('26','Dadra and Nagar Haveli and Daman and Diu'),('27','Maharashtra'),('29','Karnataka'),
  ('30','Goa'),('31','Lakshadweep'),('32','Kerala'),('33','Tamil Nadu'),('34','Puducherry'),
  ('35','Andaman and Nicobar Islands'),('36','Telangana'),('37','Andhra Pradesh'),('38','Ladakh'),
  ('97','Other Territory'),('99','Centre Jurisdiction');

alter table public.gst_states enable row level security;
create policy gst_states_read on public.gst_states for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------
create function app.gstin_valid(g text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  cs constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  s int := 0; v int; p int; i int;
begin
  if g is null or g !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then
    return false;
  end if;
  for i in 1..14 loop
    v := position(substr(g, i, 1) in cs) - 1;
    p := v * case when i % 2 = 1 then 1 else 2 end;
    s := s + p / 36 + p % 36;
  end loop;
  return substr(cs, ((36 - s % 36) % 36) + 1, 1) = substr(g, 15, 1);
end $$;

-- Keeps updated_at fresh and forbids moving a row to another org.
create function app.before_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.org_id is distinct from old.org_id then
    raise exception 'org_id is immutable' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Orgs and memberships
-- ---------------------------------------------------------------------------
create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid generated always as (id) stored,
  name text not null check (length(trim(name)) between 1 and 200),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'accountant', 'ca')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id, org_id);

-- Role lookups. Security definer so policies on memberships cannot recurse.
create function app.member_role(p_org uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role from public.memberships m
  where m.org_id = p_org and m.user_id = (select auth.uid())
  limit 1
$$;

create function app.is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.member_role(p_org) is not null
$$;

create function app.can_write(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.member_role(p_org) in ('owner', 'accountant'), false)
$$;

create function app.is_owner(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.member_role(p_org) = 'owner', false)
$$;

-- ---------------------------------------------------------------------------
-- Business profile (one per org)
-- ---------------------------------------------------------------------------
create table public.business_profile (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique references public.orgs (id) on delete cascade,
  legal_name text not null default 'My business',
  trade_name text,
  gstin text check (gstin is null or app.gstin_valid(gstin)),
  state_code char(2) references public.gst_states (code),
  registration_type text not null default 'unregistered'
    check (registration_type in ('regular', 'composition', 'unregistered')),
  annual_turnover_paise bigint not null default 0 check (annual_turnover_paise >= 0),
  udyam_number text,
  enterprise_size text check (enterprise_size in ('micro', 'small', 'medium')),
  activity text check (activity in ('manufacturing', 'services', 'trading')),
  address text,
  email text,
  phone text,
  bank_name text,
  bank_account_holder text,
  bank_account_number text,
  bank_ifsc text,
  upi_id text,
  invoice_prefix text not null default 'INV' check (invoice_prefix ~ '^[A-Z0-9]{1,4}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (gstin is null or state_code is null or left(gstin, 2) = state_code)
);

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  gstin text check (gstin is null or app.gstin_valid(gstin)),
  state_code char(2) references public.gst_states (code),
  credit_days int not null default 30 check (credit_days between 0 and 365),
  has_written_agreement boolean not null default false,
  tier text not null default 'standard' check (tier in ('key', 'standard')),
  language text not null default 'en' check (language in ('en', 'hi', 'mr')),
  entity_type text check (entity_type in ('company', 'firm', 'proprietor', 'government', 'individual')),
  presumptive_tax text not null default 'unknown' check (presumptive_tax in ('unknown', 'yes', 'no')),
  contact_name text,
  email text,
  phone text,
  contacts jsonb not null default '[]'::jsonb check (jsonb_typeof(contacts) = 'array'),
  address text,
  opt_in_whatsapp boolean not null default false,
  opt_in_whatsapp_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  check (gstin is null or state_code is null or left(gstin, 2) = state_code)
);
create index customers_org_name_idx on public.customers (org_id, name);
create unique index customers_org_gstin_uq on public.customers (org_id, gstin) where gstin is not null;

-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  customer_id uuid not null,
  number text not null check (length(number) <= 16),
  fy text not null check (fy ~ '^[0-9]{2}-[0-9]{2}$'),
  invoice_type text not null default 'tax_invoice'
    check (invoice_type in ('tax_invoice', 'bill_of_supply', 'invoice')),
  status text not null default 'draft'
    check (status in ('draft', 'issued', 'partially_paid', 'paid', 'void')),
  issue_date date not null,
  due_date date not null,
  supplier_state_code char(2) not null references public.gst_states (code),
  place_of_supply char(2) not null references public.gst_states (code),
  taxable_paise bigint not null default 0 check (taxable_paise >= 0),
  cgst_paise bigint not null default 0 check (cgst_paise >= 0),
  sgst_paise bigint not null default 0 check (sgst_paise >= 0),
  igst_paise bigint not null default 0 check (igst_paise >= 0),
  round_off_paise bigint not null default 0,
  total_paise bigint not null check (total_paise >= 0),
  paid_paise bigint not null default 0 check (paid_paise >= 0),
  notes text,
  source text not null default 'manual' check (source in ('manual', 'import')),
  source_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  unique (org_id, number),
  foreign key (customer_id, org_id) references public.customers (id, org_id),
  check (due_date >= issue_date),
  check (total_paise = taxable_paise + cgst_paise + sgst_paise + igst_paise + round_off_paise),
  check (paid_paise <= total_paise)
);
create unique index invoices_org_source_ref_uq on public.invoices (org_id, source_ref) where source_ref is not null;
create index invoices_org_customer_idx on public.invoices (org_id, customer_id);
create index invoices_org_status_due_idx on public.invoices (org_id, status, due_date);
create index invoices_org_issue_idx on public.invoices (org_id, issue_date desc);

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  invoice_id uuid not null,
  position int not null check (position >= 1),
  description text not null,
  hsn_sac text,
  qty numeric(12, 3) not null check (qty >= 0),
  unit text,
  rate_paise bigint not null check (rate_paise >= 0),
  discount_paise bigint not null default 0 check (discount_paise >= 0),
  gst_rate numeric(5, 2) not null default 0 check (gst_rate in (0, 0.25, 3, 5, 18, 40)),
  taxable_paise bigint not null check (taxable_paise >= 0),
  cgst_paise bigint not null default 0 check (cgst_paise >= 0),
  sgst_paise bigint not null default 0 check (sgst_paise >= 0),
  igst_paise bigint not null default 0 check (igst_paise >= 0),
  total_paise bigint not null check (total_paise >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (invoice_id, position),
  foreign key (invoice_id, org_id) references public.invoices (id, org_id) on delete cascade
);
create index invoice_lines_org_invoice_idx on public.invoice_lines (org_id, invoice_id);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  invoice_id uuid not null,
  note_type text not null check (note_type in ('credit', 'debit')),
  number text not null check (length(number) <= 16),
  issue_date date not null,
  reason text,
  taxable_paise bigint not null default 0 check (taxable_paise >= 0),
  cgst_paise bigint not null default 0 check (cgst_paise >= 0),
  sgst_paise bigint not null default 0 check (sgst_paise >= 0),
  igst_paise bigint not null default 0 check (igst_paise >= 0),
  total_paise bigint not null check (total_paise >= 0),
  status text not null default 'draft' check (status in ('draft', 'issued', 'void')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, number),
  foreign key (invoice_id, org_id) references public.invoices (id, org_id)
);
create index notes_org_invoice_idx on public.notes (org_id, invoice_id);

-- Gap-free per-org, per-FY counter. The row lock serialises concurrent callers and a rollback
-- of the caller's transaction also rolls back the increment, so numbers are never skipped.
create table public.invoice_counters (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  fy text not null check (fy ~ '^[0-9]{2}-[0-9]{2}$'),
  last_seq int not null default 0 check (last_seq >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, fy)
);

create function public.next_invoice_number(p_org uuid, p_fy text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_prefix text;
  v_seq int;
  v_number text;
begin
  if not app.can_write(p_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_fy is null or p_fy !~ '^[0-9]{2}-[0-9]{2}$' then
    raise exception 'invalid financial year %', p_fy using errcode = '22023';
  end if;
  select bp.invoice_prefix into v_prefix from public.business_profile bp where bp.org_id = p_org;
  v_prefix := coalesce(v_prefix, 'INV');
  insert into public.invoice_counters as c (org_id, fy, last_seq)
  values (p_org, p_fy, 1)
  on conflict (org_id, fy) do update set last_seq = c.last_seq + 1, updated_at = now()
  returning c.last_seq into v_seq;
  v_number := v_prefix || '/' || p_fy || '/' || lpad(v_seq::text, 4, '0');
  if length(v_number) > 16 then
    raise exception 'invoice number too long: %', v_number using errcode = '22001';
  end if;
  return v_number;
end $$;

-- ---------------------------------------------------------------------------
-- Payments, allocations, bank transactions
-- ---------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  customer_id uuid,
  amount_paise bigint not null check (amount_paise > 0),
  received_on date not null,
  method text not null default 'bank_transfer'
    check (method in ('upi', 'bank_transfer', 'cheque', 'cash', 'card', 'razorpay', 'other')),
  reference text,
  status text not null default 'confirmed' check (status in ('pending', 'confirmed', 'failed', 'reversed')),
  source text not null default 'manual' check (source in ('manual', 'razorpay', 'bank_import')),
  razorpay_payment_id text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (customer_id, org_id) references public.customers (id, org_id)
);
create unique index payments_org_idem_uq on public.payments (org_id, idempotency_key) where idempotency_key is not null;
create unique index payments_org_rzp_uq on public.payments (org_id, razorpay_payment_id) where razorpay_payment_id is not null;
create index payments_org_received_idx on public.payments (org_id, received_on desc);
create index payments_org_customer_idx on public.payments (org_id, customer_id);

create table public.allocations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  payment_id uuid not null,
  invoice_id uuid not null,
  amount_paise bigint not null check (amount_paise > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payment_id, invoice_id),
  foreign key (payment_id, org_id) references public.payments (id, org_id) on delete cascade,
  foreign key (invoice_id, org_id) references public.invoices (id, org_id)
);
create index allocations_org_invoice_idx on public.allocations (org_id, invoice_id);

create table public.bank_txns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  txn_date date not null,
  description text,
  direction text not null default 'credit' check (direction in ('credit', 'debit')),
  amount_paise bigint not null check (amount_paise > 0),
  reference text,
  balance_paise bigint,
  status text not null default 'unmatched' check (status in ('unmatched', 'matched', 'ignored')),
  matched_payment_id uuid,
  dedupe_hash text not null,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  unique (org_id, dedupe_hash),
  foreign key (matched_payment_id, org_id) references public.payments (id, org_id)
);
create index bank_txns_org_status_date_idx on public.bank_txns (org_id, status, txn_date desc);

-- Keeps invoices.paid_paise and status in step with allocations, and stops over-allocation.
create function app.sync_allocation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_invoice uuid;
  v_org uuid;
  v_payment uuid;
  v_paid bigint;
  v_total bigint;
  v_status text;
  v_alloc bigint;
  v_pay_amount bigint;
begin
  for v_invoice, v_org, v_payment in
    select x.invoice_id, x.org_id, x.payment_id from (
      select new.invoice_id, new.org_id, new.payment_id where tg_op in ('INSERT', 'UPDATE')
      union
      select old.invoice_id, old.org_id, old.payment_id where tg_op in ('DELETE', 'UPDATE')
    ) x
  loop
    select coalesce(sum(a.amount_paise), 0) into v_paid
      from public.allocations a where a.invoice_id = v_invoice and a.org_id = v_org;
    select i.total_paise, i.status into v_total, v_status
      from public.invoices i where i.id = v_invoice and i.org_id = v_org for update;
    if v_total is null then continue; end if;
    if v_paid > v_total then
      raise exception 'allocations exceed invoice total' using errcode = '23514';
    end if;
    select coalesce(sum(a.amount_paise), 0) into v_alloc
      from public.allocations a where a.payment_id = v_payment and a.org_id = v_org;
    select p.amount_paise into v_pay_amount
      from public.payments p where p.id = v_payment and p.org_id = v_org;
    if v_pay_amount is not null and v_alloc > v_pay_amount then
      raise exception 'allocations exceed payment amount' using errcode = '23514';
    end if;
    update public.invoices set
      paid_paise = v_paid,
      status = case
        when v_status in ('draft', 'void') then v_status
        when v_paid = 0 then 'issued'
        when v_paid >= v_total then 'paid'
        else 'partially_paid' end
      where id = v_invoice and org_id = v_org;
  end loop;
  return null;
end $$;

create trigger allocations_sync after insert or update or delete on public.allocations
  for each row execute function app.sync_allocation();

-- ---------------------------------------------------------------------------
-- Collections: disputes, promises, reminders, messages
-- ---------------------------------------------------------------------------
create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  invoice_id uuid not null,
  customer_id uuid,
  reason text not null,
  status text not null default 'open' check (status in ('open', 'resolved', 'rejected')),
  raised_via text not null default 'manual' check (raised_via in ('manual', 'portal', 'whatsapp', 'email')),
  raised_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (invoice_id, org_id) references public.invoices (id, org_id),
  foreign key (customer_id, org_id) references public.customers (id, org_id)
);
create index disputes_org_invoice_idx on public.disputes (org_id, invoice_id);
create index disputes_org_status_idx on public.disputes (org_id, status);

create table public.promises (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  invoice_id uuid not null,
  customer_id uuid,
  promised_amount_paise bigint check (promised_amount_paise > 0),
  promised_for date not null,
  status text not null default 'open' check (status in ('open', 'kept', 'broken', 'cancelled')),
  source text not null default 'manual' check (source in ('manual', 'portal', 'agent', 'whatsapp')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (invoice_id, org_id) references public.invoices (id, org_id),
  foreign key (customer_id, org_id) references public.customers (id, org_id)
);
create index promises_org_invoice_idx on public.promises (org_id, invoice_id);
create index promises_org_status_date_idx on public.promises (org_id, status, promised_for);

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  invoice_id uuid not null,
  customer_id uuid,
  stage text not null
    check (stage in ('pre_due', 'due_today', 'overdue_gentle', 'overdue_firm', 'final', 'demand_letter')),
  channel text not null default 'whatsapp' check (channel in ('whatsapp', 'email', 'sms')),
  status text not null default 'scheduled'
    check (status in ('scheduled', 'sent', 'skipped', 'failed', 'cancelled')),
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  unique (org_id, invoice_id, stage, channel),
  foreign key (invoice_id, org_id) references public.invoices (id, org_id),
  foreign key (customer_id, org_id) references public.customers (id, org_id)
);
create index reminders_org_status_sched_idx on public.reminders (org_id, status, scheduled_for);
create index reminders_org_invoice_idx on public.reminders (org_id, invoice_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  customer_id uuid,
  invoice_id uuid,
  reminder_id uuid,
  channel text not null check (channel in ('whatsapp', 'email', 'sms')),
  direction text not null default 'outbound' check (direction in ('outbound', 'inbound')),
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'delivered', 'read', 'failed')),
  body text not null,
  provider_message_id text,
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (customer_id, org_id) references public.customers (id, org_id),
  foreign key (invoice_id, org_id) references public.invoices (id, org_id),
  foreign key (reminder_id, org_id) references public.reminders (id, org_id)
);
create index messages_org_customer_idx on public.messages (org_id, customer_id, created_at desc);
create index messages_org_invoice_idx on public.messages (org_id, invoice_id);
create unique index messages_org_provider_uq on public.messages (org_id, provider_message_id) where provider_message_id is not null;

-- ---------------------------------------------------------------------------
-- Expenses, TDS, IMS, agent actions
-- ---------------------------------------------------------------------------
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null,
  category text,
  amount_paise bigint not null check (amount_paise > 0),
  expense_date date not null,
  is_recurring boolean not null default false,
  recurrence text check (recurrence in ('weekly', 'monthly', 'quarterly', 'yearly')),
  next_due date,
  ends_on date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not is_recurring or recurrence is not null)
);
create index expenses_org_date_idx on public.expenses (org_id, expense_date desc);
create index expenses_org_recurring_idx on public.expenses (org_id, next_due) where is_recurring and active;

create table public.tds_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  customer_id uuid,
  invoice_id uuid,
  payment_id uuid,
  section text not null check (section in ('194C', '194H', '194I', '194J', '194O', '194Q', 'other')),
  rate numeric(5, 2) not null check (rate >= 0 and rate <= 100),
  amount_paise bigint not null check (amount_paise >= 0),
  deducted_on date,
  financial_year text check (financial_year ~ '^[0-9]{2}-[0-9]{2}$'),
  certificate_status text not null default 'pending'
    check (certificate_status in ('pending', 'requested', 'received', 'not_applicable')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (customer_id, org_id) references public.customers (id, org_id),
  foreign key (invoice_id, org_id) references public.invoices (id, org_id),
  foreign key (payment_id, org_id) references public.payments (id, org_id)
);
create index tds_entries_org_customer_idx on public.tds_entries (org_id, customer_id);
create index tds_entries_org_cert_idx on public.tds_entries (org_id, certificate_status);

-- Buyer-side GST Invoice Management System (IMS) action recorded against an invoice.
create table public.ims_status (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  invoice_id uuid not null,
  status text not null default 'no_action' check (status in ('no_action', 'accepted', 'rejected', 'pending')),
  tax_period text,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (invoice_id),
  foreign key (invoice_id, org_id) references public.invoices (id, org_id) on delete cascade
);
create index ims_status_org_status_idx on public.ims_status (org_id, status);

create table public.agent_actions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  invoice_id uuid,
  customer_id uuid,
  action_type text not null,
  status text not null default 'proposed'
    check (status in ('proposed', 'approved', 'executed', 'rejected', 'failed')),
  reasoning text,
  payload jsonb not null default '{}'::jsonb,
  policy_checks jsonb not null default '[]'::jsonb,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  executed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (invoice_id, org_id) references public.invoices (id, org_id),
  foreign key (customer_id, org_id) references public.customers (id, org_id)
);
create index agent_actions_org_status_idx on public.agent_actions (org_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- Pay tokens: only sha256 hashes are stored; plaintext is returned once at creation.
-- ---------------------------------------------------------------------------
create table public.pay_tokens (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  invoice_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > created_at),
  foreign key (invoice_id, org_id) references public.invoices (id, org_id) on delete cascade
);
create index pay_tokens_org_invoice_idx on public.pay_tokens (org_id, invoice_id);

create function public.create_pay_token(p_invoice uuid, p_ttl interval default interval '30 days')
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_token text;
begin
  select i.org_id into v_org from public.invoices i where i.id = p_invoice;
  if v_org is null or not app.can_write(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_ttl <= interval '0' or p_ttl > interval '180 days' then
    raise exception 'invalid ttl' using errcode = '22023';
  end if;
  v_token := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
  insert into public.pay_tokens (org_id, invoice_id, token_hash, expires_at, created_by)
  values (v_org, p_invoice,
          encode(extensions.digest(v_token, 'sha256'), 'hex'),
          now() + p_ttl, (select auth.uid()));
  return v_token;
end $$;

-- ---------------------------------------------------------------------------
-- Audit log: append-only, written only by triggers.
-- No FK on org_id so the trail outlives an org.
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  actor_id uuid,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  table_name text not null,
  record_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index audit_log_org_created_idx on public.audit_log (org_id, created_at desc);
create index audit_log_org_record_idx on public.audit_log (org_id, table_name, record_id);

create function app.audit_block() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_log is append-only' using errcode = '42501';
end $$;

create trigger audit_log_no_update_delete before update or delete on public.audit_log
  for each row execute function app.audit_block();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function app.audit_block();

create function app.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb;
begin
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  insert into public.audit_log (org_id, actor_id, action, table_name, record_id, old_data, new_data)
  values (
    (v_row ->> 'org_id')::uuid,
    (select auth.uid()),
    tg_op,
    tg_table_name,
    (v_row ->> 'id')::uuid,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) - 'token_hash' end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) - 'token_hash' end
  );
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Triggers on every org table (updated_at, org_id immutability, audit) and RLS
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  all_tables text[] := array[
    'orgs', 'memberships', 'business_profile', 'customers', 'invoices', 'invoice_lines', 'notes',
    'invoice_counters', 'payments', 'allocations', 'bank_txns', 'disputes', 'promises', 'reminders',
    'messages', 'expenses', 'tds_entries', 'ims_status', 'agent_actions', 'pay_tokens'
  ];
  standard_tables text[] := array[
    'customers', 'invoices', 'invoice_lines', 'notes', 'payments', 'allocations', 'bank_txns',
    'disputes', 'promises', 'reminders', 'messages', 'expenses', 'tds_entries', 'ims_status',
    'agent_actions'
  ];
  owner_write_tables text[] := array['memberships', 'business_profile'];
begin
  foreach t in array all_tables loop
    execute format('create trigger %I before update on public.%I for each row execute function app.before_update()', t || '_before_update', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_row()', t || '_audit', t);
  end loop;

  foreach t in array all_tables || array['audit_log'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  -- Standard: any member reads; owner and accountant write.
  foreach t in array standard_tables loop
    execute format('create policy %I on public.%I for select to authenticated using (app.is_member(org_id))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (app.can_write(org_id))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (app.can_write(org_id)) with check (app.can_write(org_id))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (app.can_write(org_id))', t || '_delete', t);
  end loop;

  -- Owner-only writes, members read.
  foreach t in array owner_write_tables loop
    execute format('create policy %I on public.%I for select to authenticated using (app.is_member(org_id))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (app.is_owner(org_id))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (app.is_owner(org_id)) with check (app.is_owner(org_id))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (app.is_owner(org_id))', t || '_delete', t);
  end loop;
end $$;

-- orgs: members read, owner renames. Creation only through the signup trigger; no client delete.
create policy orgs_select on public.orgs for select to authenticated using (app.is_member(id));
create policy orgs_update on public.orgs for update to authenticated
  using (app.is_owner(id)) with check (app.is_owner(id));

-- Read-only to clients: counters (function-written), pay tokens (function-written), audit log.
create policy invoice_counters_select on public.invoice_counters for select to authenticated
  using (app.is_member(org_id));
create policy pay_tokens_select on public.pay_tokens for select to authenticated
  using (app.can_write(org_id));
create policy audit_log_select on public.audit_log for select to authenticated
  using (app.is_member(org_id));

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;
grant select on public.gst_states to authenticated;

grant select, insert, update, delete on
  public.customers, public.invoices, public.invoice_lines, public.notes, public.payments,
  public.allocations, public.bank_txns, public.disputes, public.promises, public.reminders,
  public.messages, public.expenses, public.tds_entries, public.ims_status, public.agent_actions,
  public.memberships, public.business_profile
to authenticated;
grant select, update on public.orgs to authenticated;
grant select on public.invoice_counters, public.pay_tokens, public.audit_log to authenticated;

grant usage on schema app to authenticated;
revoke execute on all functions in schema app from public, anon;
grant execute on function app.member_role(uuid), app.is_member(uuid), app.can_write(uuid),
  app.is_owner(uuid), app.gstin_valid(text) to authenticated;

revoke execute on function public.next_invoice_number(uuid, text) from public, anon;
revoke execute on function public.create_pay_token(uuid, interval) from public, anon;
grant execute on function public.next_invoice_number(uuid, text) to authenticated;
grant execute on function public.create_pay_token(uuid, interval) to authenticated;

-- ---------------------------------------------------------------------------
-- Signup: every new user gets an org "My business" and becomes its owner.
-- Demo users (raw_user_meta_data.demo = true) are attached to the demo org by the edge function.
-- ---------------------------------------------------------------------------
create function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  if coalesce(new.raw_user_meta_data ->> 'demo', 'false') = 'true' then
    return new;
  end if;
  insert into public.orgs (name, created_by) values ('My business', new.id) returning id into v_org;
  insert into public.memberships (org_id, user_id, role) values (v_org, new.id, 'owner');
  insert into public.business_profile (org_id) values (v_org);
  return new;
end $$;

revoke execute on function app.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();
