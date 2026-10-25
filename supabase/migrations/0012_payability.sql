-- S10: payability, acceptance proof, statements, instalments, credit limit.

-- Customers: accounts-payable contact, PO rule, preferred channel, owner copy, credit limit override.
alter table public.customers
  add column ap_name text,
  add column ap_email text,
  add column ap_phone text,
  add column po_required boolean not null default false,
  add column preferred_channel text check (preferred_channel in ('email', 'whatsapp', 'sms')),
  add column cc_owner boolean not null default false,
  add column credit_limit_paise bigint check (credit_limit_paise >= 0);

-- Business: issue threshold, monthly statement send.
alter table public.business_profile
  add column payability_threshold int not null default 70 check (payability_threshold between 0 and 100),
  add column statement_monthly boolean not null default false;

-- Invoices: references, payability, acceptance. accepted_on (S3) is the acceptance date.
alter table public.invoices
  add column po_number text,
  add column eway_bill_no text,
  add column delivery_ref text,
  add column payability_score int check (payability_score between 0 and 100),
  add column payability_override boolean not null default false,
  add column payability_override_reason text,
  add column acceptance_source text
    check (acceptance_source in ('buyer_confirmed', 'proof_uploaded', 'assumed_delivery_date')),
  add column acceptance_note text;

-- ---------------------------------------------------------------------------
-- save_invoice carries the new header fields.
-- ---------------------------------------------------------------------------
create or replace function public.save_invoice(
  p_org uuid, p_id uuid, p_expected timestamptz, p_header jsonb, p_lines jsonb
) returns public.invoices
language plpgsql security invoker set search_path = '' as $$
declare
  v public.invoices;
begin
  if p_id is null then
    insert into public.invoices (
      org_id, customer_id, fy, invoice_type, status, issue_date, due_date, supplier_state_code,
      place_of_supply, taxable_paise, cgst_paise, sgst_paise, igst_paise, round_off_paise, total_paise,
      notes, reverse_charge, delivery_address, po_number, eway_bill_no, delivery_ref, payability_score
    ) values (
      p_org, (p_header ->> 'customer_id')::uuid, p_header ->> 'fy', p_header ->> 'invoice_type', 'draft',
      (p_header ->> 'issue_date')::date, (p_header ->> 'due_date')::date,
      p_header ->> 'supplier_state_code', p_header ->> 'place_of_supply',
      (p_header ->> 'taxable_paise')::bigint, (p_header ->> 'cgst_paise')::bigint,
      (p_header ->> 'sgst_paise')::bigint, (p_header ->> 'igst_paise')::bigint,
      (p_header ->> 'round_off_paise')::bigint, (p_header ->> 'total_paise')::bigint,
      p_header ->> 'notes', coalesce((p_header ->> 'reverse_charge')::boolean, false),
      p_header ->> 'delivery_address', nullif(trim(p_header ->> 'po_number'), ''),
      nullif(trim(p_header ->> 'eway_bill_no'), ''), nullif(trim(p_header ->> 'delivery_ref'), ''),
      (p_header ->> 'payability_score')::int
    ) returning * into v;
  else
    update public.invoices set
      customer_id = (p_header ->> 'customer_id')::uuid, fy = p_header ->> 'fy',
      invoice_type = p_header ->> 'invoice_type',
      issue_date = (p_header ->> 'issue_date')::date, due_date = (p_header ->> 'due_date')::date,
      supplier_state_code = p_header ->> 'supplier_state_code', place_of_supply = p_header ->> 'place_of_supply',
      taxable_paise = (p_header ->> 'taxable_paise')::bigint, cgst_paise = (p_header ->> 'cgst_paise')::bigint,
      sgst_paise = (p_header ->> 'sgst_paise')::bigint, igst_paise = (p_header ->> 'igst_paise')::bigint,
      round_off_paise = (p_header ->> 'round_off_paise')::bigint, total_paise = (p_header ->> 'total_paise')::bigint,
      notes = p_header ->> 'notes', reverse_charge = coalesce((p_header ->> 'reverse_charge')::boolean, false),
      delivery_address = p_header ->> 'delivery_address',
      po_number = nullif(trim(p_header ->> 'po_number'), ''),
      eway_bill_no = nullif(trim(p_header ->> 'eway_bill_no'), ''),
      delivery_ref = nullif(trim(p_header ->> 'delivery_ref'), ''),
      payability_score = (p_header ->> 'payability_score')::int,
      payability_override = false, payability_override_reason = null
    where id = p_id and org_id = p_org and status = 'draft' and updated_at = p_expected
    returning * into v;
    if not found then
      if exists (select 1 from public.invoices where id = p_id and org_id = p_org and status = 'draft') then
        raise exception 'conflict' using errcode = '40001';
      end if;
      raise exception 'draft invoice not found' using errcode = 'P0002';
    end if;
    delete from public.invoice_lines where invoice_id = p_id and org_id = p_org;
  end if;

  insert into public.invoice_lines (
    org_id, invoice_id, position, description, hsn_sac, qty, unit, rate_paise, discount_paise, gst_rate,
    taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise
  )
  select p_org, v.id, e.ord::int, e.l ->> 'description', e.l ->> 'hsn_sac', (e.l ->> 'qty')::numeric,
         e.l ->> 'unit', (e.l ->> 'rate_paise')::bigint, coalesce((e.l ->> 'discount_paise')::bigint, 0),
         (e.l ->> 'gst_rate')::numeric, (e.l ->> 'taxable_paise')::bigint, (e.l ->> 'cgst_paise')::bigint,
         (e.l ->> 'sgst_paise')::bigint, (e.l ->> 'igst_paise')::bigint, (e.l ->> 'total_paise')::bigint
  from jsonb_array_elements(p_lines) with ordinality as e(l, ord);

  select * into v from public.invoices where id = v.id;
  return v;
end $$;

-- Owner override of the payability gate. The reason is stored on the invoice; the audit trigger logs the change.
create function public.override_payability(p_invoice uuid, p_reason text) returns public.invoices
language plpgsql security definer set search_path = '' as $$
declare
  v public.invoices;
begin
  select * into v from public.invoices where id = p_invoice for update;
  if not found or not app.is_owner(v.org_id) then
    raise exception 'only the owner can override' using errcode = '42501';
  end if;
  if v.status <> 'draft' then
    raise exception 'invoice is not a draft' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  update public.invoices set payability_override = true, payability_override_reason = left(trim(p_reason), 500)
   where id = p_invoice returning * into v;
  return v;
end $$;
revoke execute on function public.override_payability(uuid, text) from public, anon;
grant execute on function public.override_payability(uuid, text) to authenticated;

-- Issue is blocked below the org's threshold unless the owner overrode it.
create or replace function public.issue_invoice(p_invoice uuid, p_expected timestamptz) returns public.invoices
language plpgsql security definer set search_path = '' as $$
declare
  v public.invoices;
  v_threshold int;
begin
  select * into v from public.invoices where id = p_invoice for update;
  if not found or not app.can_write(v.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v.updated_at <> p_expected then
    raise exception 'conflict' using errcode = '40001';
  end if;
  if v.status <> 'draft' then
    raise exception 'invoice is not a draft' using errcode = '22023';
  end if;
  if not exists (select 1 from public.invoice_lines l where l.invoice_id = v.id) then
    raise exception 'invoice has no lines' using errcode = '22023';
  end if;
  select payability_threshold into v_threshold from public.business_profile where org_id = v.org_id;
  if v.payability_score is not null and v.payability_score < coalesce(v_threshold, 70) and not v.payability_override then
    raise exception 'payability score % is below %; the owner can override', v.payability_score, v_threshold
      using errcode = 'P0001';
  end if;
  update public.invoices
     set number = public.next_invoice_number(v.org_id, v.fy), status = 'issued'
   where id = p_invoice
   returning * into v;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Delivery proof: private Storage bucket + one row per file. Proof sets the acceptance date unless the buyer
-- already confirmed.
-- ---------------------------------------------------------------------------
create table public.delivery_proofs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  invoice_id uuid not null,
  path text not null check (length(path) between 10 and 300),
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes int not null check (size_bytes > 0 and size_bytes <= 5242880),
  delivered_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (invoice_id, org_id) references public.invoices (id, org_id) on delete cascade,
  unique (org_id, path)
);
create index delivery_proofs_org_invoice_idx on public.delivery_proofs (org_id, invoice_id);

create function app.apply_proof() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.invoices
     set accepted_on = new.delivered_on, acceptance_source = 'proof_uploaded'
   where id = new.invoice_id and org_id = new.org_id
     and acceptance_source is distinct from 'buyer_confirmed';
  return new;
end $$;
create trigger delivery_proofs_apply after insert on public.delivery_proofs
  for each row execute function app.apply_proof();

-- Owner records a delivery date they know (assumed): never overrides a stronger source.
create function public.record_assumed_delivery(p_invoice uuid, p_date date) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  update public.invoices
     set accepted_on = p_date, acceptance_source = 'assumed_delivery_date'
   where id = p_invoice and (acceptance_source is null or acceptance_source = 'assumed_delivery_date');
  if not found then
    raise exception 'acceptance already recorded or invoice not found' using errcode = '22023';
  end if;
end $$;
revoke execute on function public.record_assumed_delivery(uuid, date) from public, anon;
grant execute on function public.record_assumed_delivery(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Instalment plans (buyer requests on the pay page; owner approves; approval creates promises).
-- ---------------------------------------------------------------------------
create table public.instalment_plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  invoice_id uuid not null,
  customer_id uuid,
  status text not null default 'requested' check (status in ('requested', 'approved', 'rejected', 'cancelled')),
  total_paise bigint not null check (total_paise > 0),
  owner_reply text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (invoice_id, org_id) references public.invoices (id, org_id),
  foreign key (customer_id, org_id) references public.customers (id, org_id),
  unique (id, org_id)
);
create unique index instalment_plans_active_uq on public.instalment_plans (invoice_id)
  where status in ('requested', 'approved');
create index instalment_plans_org_status_idx on public.instalment_plans (org_id, status, created_at desc);

create table public.instalments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  plan_id uuid not null,
  seq int not null check (seq between 1 and 4),
  due_on date not null,
  amount_paise bigint not null check (amount_paise > 0),
  promise_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (plan_id, org_id) references public.instalment_plans (id, org_id) on delete cascade,
  foreign key (promise_id) references public.promises (id) on delete set null,
  unique (plan_id, seq)
);
create index instalments_org_plan_idx on public.instalments (org_id, plan_id);

-- Owner decision. Approve creates one promise per instalment (these feed the forecast and pause the ladder).
create function public.decide_instalment_plan(p_org uuid, p_plan uuid, p_approve boolean, p_reply text default null)
returns public.instalment_plans
language plpgsql security invoker set search_path = '' as $$
declare
  p public.instalment_plans;
  i record;
  v_promise uuid;
begin
  select * into p from public.instalment_plans where id = p_plan and org_id = p_org for update;
  if not found then
    raise exception 'plan not found' using errcode = 'P0002';
  end if;
  if p.status <> 'requested' then
    raise exception 'plan already decided' using errcode = '22023';
  end if;
  if p_approve then
    for i in select * from public.instalments where plan_id = p_plan and org_id = p_org order by seq loop
      insert into public.promises (org_id, invoice_id, customer_id, promised_amount_paise, promised_for, source, note)
        values (p_org, p.invoice_id, p.customer_id, i.amount_paise, i.due_on, 'portal',
                'Instalment ' || i.seq || ' of the approved plan')
        returning id into v_promise;
      update public.instalments set promise_id = v_promise where id = i.id;
    end loop;
  end if;
  update public.instalment_plans
     set status = case when p_approve then 'approved' else 'rejected' end,
         owner_reply = left(nullif(trim(p_reply), ''), 1000), decided_at = now()
   where id = p_plan returning * into p;
  return p;
end $$;
revoke execute on function public.decide_instalment_plan(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.decide_instalment_plan(uuid, uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Statements of account: customer-level token, buyer responses.
-- ---------------------------------------------------------------------------
create table public.statement_tokens (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  customer_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (customer_id, org_id) references public.customers (id, org_id) on delete cascade
);
create index statement_tokens_org_customer_idx on public.statement_tokens (org_id, customer_id);

create table public.statement_responses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  customer_id uuid not null,
  kind text not null check (kind in ('confirmed', 'disputed_line')),
  invoice_id uuid,
  balance_paise bigint not null check (balance_paise >= 0),
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (customer_id, org_id) references public.customers (id, org_id) on delete cascade,
  foreign key (invoice_id, org_id) references public.invoices (id, org_id)
);
create index statement_responses_org_customer_idx on public.statement_responses (org_id, customer_id, created_at desc);

create function public.create_statement_token(p_customer uuid, p_ttl interval default interval '30 days')
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_token text;
begin
  select c.org_id into v_org from public.customers c where c.id = p_customer;
  if v_org is null or not app.can_write(v_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_ttl <= interval '0' or p_ttl > interval '180 days' then
    raise exception 'invalid ttl' using errcode = '22023';
  end if;
  v_token := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
  insert into public.statement_tokens (org_id, customer_id, token_hash, expires_at, created_by)
  values (v_org, p_customer, encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + p_ttl, (select auth.uid()));
  return v_token;
end $$;
revoke execute on function public.create_statement_token(uuid, interval) from public, anon;
grant execute on function public.create_statement_token(uuid, interval) to authenticated;

create function app.statement_token(p_token text) returns table (customer_id uuid, org_id uuid, token_id uuid)
language sql security definer set search_path = '' stable as $$
  select t.customer_id, t.org_id, t.id from public.statement_tokens t
  where t.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and t.expires_at > now() and t.revoked_at is null
$$;
revoke execute on function app.statement_token(text) from public, anon, authenticated;

-- The buyer's open ledger: every open invoice with its credit notes, payments and TDS. Service role only.
create function app.statement_json(p_org uuid, p_customer uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'business_name', coalesce(nullif(bp.trade_name, ''), bp.legal_name),
    'customer_name', c.name,
    'language', c.language,
    'as_of', (now() at time zone 'Asia/Kolkata')::date,
    'invoices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'number', i.number, 'issue_date', i.issue_date, 'due_date', i.due_date,
        'total_paise', i.total_paise, 'paid_paise', i.paid_paise, 'credited_paise', i.credited_paise,
        'tds_paise', i.tds_paise, 'balance_paise', i.balance_paise, 'disputed', i.disputed
      ) order by i.issue_date, i.number)
      from public.invoices i
      where i.org_id = p_org and i.customer_id = p_customer and i.status not in ('draft', 'void') and i.balance_paise > 0
    ), '[]'::jsonb),
    'credit_notes', coalesce((
      select jsonb_agg(jsonb_build_object('number', n.number, 'date', n.issue_date, 'invoice_id', n.invoice_id,
                                          'amount_paise', n.total_paise) order by n.issue_date)
      from public.notes n join public.invoices i on i.id = n.invoice_id and i.org_id = n.org_id
      where n.org_id = p_org and i.customer_id = p_customer and n.note_type = 'credit' and n.status = 'issued'
        and i.status not in ('draft', 'void') and i.balance_paise > 0
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('date', p.received_on, 'invoice_id', a.invoice_id,
                                          'amount_paise', a.amount_paise, 'method', p.method) order by p.received_on)
      from public.allocations a
      join public.payments p on p.id = a.payment_id and p.org_id = a.org_id and p.status = 'confirmed'
      join public.invoices i on i.id = a.invoice_id and i.org_id = a.org_id
      where a.org_id = p_org and i.customer_id = p_customer and i.status not in ('draft', 'void') and i.balance_paise > 0
    ), '[]'::jsonb),
    'tds', coalesce((
      select jsonb_agg(jsonb_build_object('date', t.deducted_on, 'invoice_id', t.invoice_id,
                                          'amount_paise', t.amount_paise, 'section', t.section) order by t.deducted_on)
      from public.tds_entries t join public.invoices i on i.id = t.invoice_id and i.org_id = t.org_id
      where t.org_id = p_org and i.customer_id = p_customer and i.status not in ('draft', 'void') and i.balance_paise > 0
    ), '[]'::jsonb),
    'balance_paise', coalesce((
      select sum(i.balance_paise) from public.invoices i
      where i.org_id = p_org and i.customer_id = p_customer and i.status not in ('draft', 'void') and i.balance_paise > 0
    ), 0),
    'last_response', (
      select jsonb_build_object('kind', r.kind, 'at', r.created_at)
      from public.statement_responses r where r.org_id = p_org and r.customer_id = p_customer
      order by r.created_at desc limit 1
    )
  )
  from public.customers c join public.business_profile bp on bp.org_id = c.org_id
  where c.id = p_customer and c.org_id = p_org
$$;
revoke execute on function app.statement_json(uuid, uuid) from public, anon, authenticated;

create function public.statement_view(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t record;
begin
  select * into t from app.statement_token(p_token);
  if t.customer_id is null then
    return null;
  end if;
  update public.statement_tokens set used_at = coalesce(used_at, now()) where id = t.token_id;
  return app.statement_json(t.org_id, t.customer_id);
end $$;
revoke execute on function public.statement_view(text) from public, anon, authenticated;
grant execute on function public.statement_view(text) to service_role;

-- kind: confirm | dispute_line {invoice_id, reason}. Dispute also opens a normal dispute (pauses the ladder).
create function public.statement_action(p_token text, p_kind text, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  t record;
  v_bal bigint;
  v_id uuid;
  v_inv uuid;
begin
  select * into t from app.statement_token(p_token);
  if t.customer_id is null then
    raise exception 'invalid or expired link' using errcode = '42501';
  end if;
  select coalesce(sum(i.balance_paise), 0) into v_bal from public.invoices i
   where i.org_id = t.org_id and i.customer_id = t.customer_id and i.status not in ('draft', 'void') and i.balance_paise > 0;
  if p_kind = 'confirm' then
    insert into public.statement_responses (org_id, customer_id, kind, balance_paise)
      values (t.org_id, t.customer_id, 'confirmed', v_bal) returning id into v_id;
  elsif p_kind = 'dispute_line' then
    v_inv := nullif(p_payload ->> 'invoice_id', '')::uuid;
    if coalesce(trim(p_payload ->> 'reason'), '') = '' then
      raise exception 'reason required' using errcode = '22023';
    end if;
    if not exists (select 1 from public.invoices i where i.id = v_inv and i.org_id = t.org_id and i.customer_id = t.customer_id
                   and i.status not in ('draft', 'void')) then
      raise exception 'invoice not on this statement' using errcode = '22023';
    end if;
    insert into public.statement_responses (org_id, customer_id, kind, invoice_id, balance_paise, reason)
      values (t.org_id, t.customer_id, 'disputed_line', v_inv, v_bal, left(trim(p_payload ->> 'reason'), 2000))
      returning id into v_id;
    insert into public.disputes (org_id, invoice_id, customer_id, reason, raised_via)
      values (t.org_id, v_inv, t.customer_id, left('From statement: ' || trim(p_payload ->> 'reason'), 2000), 'portal');
  else
    raise exception 'unknown action' using errcode = '22023';
  end if;
  return v_id;
end $$;
revoke execute on function public.statement_action(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.statement_action(text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Pay page extras: goods/services received, instalment request. Limits mirror src/lib/instalments/config.ts.
-- ---------------------------------------------------------------------------
create function public.pay_extra_view(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_inv uuid;
  v_org uuid;
begin
  select ti.invoice_id, ti.org_id into v_inv, v_org from app.token_invoice(p_token) ti;
  if v_inv is null then
    return null;
  end if;
  return (
    select jsonb_build_object(
      'acceptance_source', i.acceptance_source,
      'plan', (select jsonb_build_object('status', p.status, 'owner_reply', p.owner_reply,
                 'items', (select coalesce(jsonb_agg(jsonb_build_object('seq', n.seq, 'due_on', n.due_on, 'amount_paise', n.amount_paise) order by n.seq), '[]'::jsonb)
                           from public.instalments n where n.plan_id = p.id and n.org_id = p.org_id))
               from public.instalment_plans p where p.invoice_id = i.id and p.org_id = i.org_id
                and p.status in ('requested', 'approved') limit 1)
    ) from public.invoices i where i.id = v_inv and i.org_id = v_org
  );
end $$;
revoke execute on function public.pay_extra_view(text) from public, anon, authenticated;
grant execute on function public.pay_extra_view(text) to service_role;

create function public.pay_extra(p_token text, p_kind text, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_inv uuid;
  v_org uuid;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_date date;
  inv public.invoices;
  v_plan uuid;
  it jsonb;
  n int;
  v_sum bigint := 0;
  v_prev date := null;
  v_amt bigint;
begin
  select ti.invoice_id, ti.org_id into v_inv, v_org from app.token_invoice(p_token) ti;
  if v_inv is null then
    raise exception 'invalid or expired link' using errcode = '42501';
  end if;
  select * into inv from public.invoices where id = v_inv and org_id = v_org for update;
  if inv.status in ('draft', 'void') then
    raise exception 'invoice not payable' using errcode = '42501';
  end if;
  if p_kind = 'received' then
    v_date := nullif(p_payload ->> 'date', '')::date;
    if v_date is null or v_date > v_today or v_date < inv.issue_date then
      raise exception 'received date must be between the invoice date and today' using errcode = '22023';
    end if;
    update public.invoices
       set accepted_on = v_date, acceptance_source = 'buyer_confirmed',
           acceptance_note = left(nullif(trim(p_payload ->> 'note'), ''), 500)
     where id = v_inv and org_id = v_org;
    return v_inv;
  elsif p_kind = 'instalments' then
    if inv.balance_paise <= 0 then
      raise exception 'nothing to pay' using errcode = '22023';
    end if;
    n := jsonb_array_length(coalesce(p_payload -> 'items', '[]'::jsonb));
    if n < 2 or n > 4 then
      raise exception 'choose 2 to 4 instalments' using errcode = '22023';
    end if;
    for it in select * from jsonb_array_elements(p_payload -> 'items') loop
      v_date := (it ->> 'date')::date;
      v_amt := (it ->> 'amount_paise')::bigint;
      if v_amt is null or v_amt <= 0 or v_date is null or v_date < v_today or v_date > v_today + 90
         or (v_prev is not null and v_date < v_prev + 7) then
        raise exception 'instalment dates must be within 90 days and at least 7 days apart' using errcode = '22023';
      end if;
      v_prev := v_date;
      v_sum := v_sum + v_amt;
    end loop;
    if v_sum <> inv.balance_paise then
      raise exception 'instalments must add up to the balance' using errcode = '22023';
    end if;
    if exists (select 1 from public.instalment_plans p where p.invoice_id = v_inv and p.org_id = v_org
               and p.status in ('requested', 'approved')) then
      raise exception 'a plan already exists for this invoice' using errcode = '22023';
    end if;
    insert into public.instalment_plans (org_id, invoice_id, customer_id, total_paise)
      values (v_org, v_inv, inv.customer_id, v_sum) returning id into v_plan;
    insert into public.instalments (org_id, plan_id, seq, due_on, amount_paise)
      select v_org, v_plan, e.ord::int, (e.it ->> 'date')::date, (e.it ->> 'amount_paise')::bigint
      from jsonb_array_elements(p_payload -> 'items') with ordinality as e(it, ord);
    return v_plan;
  end if;
  raise exception 'unknown action' using errcode = '22023';
end $$;
revoke execute on function public.pay_extra(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.pay_extra(text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- RLS, triggers, indexes for the new tables.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['delivery_proofs', 'instalment_plans', 'instalments', 'statement_responses'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (org_id in (select app.org_ids()))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (org_id in (select app.writer_org_ids()))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (org_id in (select app.writer_org_ids())) with check (org_id in (select app.writer_org_ids()))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (org_id in (select app.writer_org_ids()))', t || '_delete', t);
  end loop;
  -- statement_tokens: like pay_tokens, writers read, writes only through create_statement_token.
  alter table public.statement_tokens enable row level security;
  create policy statement_tokens_select on public.statement_tokens for select to authenticated
    using (org_id in (select app.writer_org_ids()));
  foreach t in array array['delivery_proofs', 'instalment_plans', 'instalments', 'statement_responses', 'statement_tokens'] loop
    execute format('create trigger %I before update on public.%I for each row execute function app.before_update()', t || '_before_update', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_row()', t || '_audit', t);
  end loop;
end $$;

-- Private bucket for delivery proof (5 MB, images and PDF); skipped where Storage does not exist (tests).
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('delivery-proofs', 'delivery-proofs', false, 5242880,
            array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
    on conflict (id) do update set public = false, file_size_limit = 5242880,
      allowed_mime_types = excluded.allowed_mime_types;
    create policy delivery_proofs_read on storage.objects for select to authenticated
      using (bucket_id = 'delivery-proofs' and (storage.foldername(name))[1]::uuid in (select app.org_ids()));
    create policy delivery_proofs_write on storage.objects for insert to authenticated
      with check (bucket_id = 'delivery-proofs' and (storage.foldername(name))[1]::uuid in (select app.writer_org_ids()));
  end if;
end $$;
