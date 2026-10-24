-- S4 buyer portal, payments, reconciliation.

-- ---------------------------------------------------------------------------
-- Credit notes reduce the invoice balance: invoices.credited_paise follows issued credit notes.
-- ---------------------------------------------------------------------------
alter table public.invoices
  add column credited_paise bigint not null default 0 check (credited_paise >= 0),
  add column tds_paise bigint not null default 0 check (tds_paise >= 0),
  add column balance_paise bigint generated always as
    (greatest(total_paise - paid_paise - credited_paise - tds_paise, 0)) stored,
  add column razorpay_link_id text,
  add column razorpay_link_url text;

-- One place that derives status from paid + credited.
create function app.refresh_invoice(p_invoice uuid, p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_total bigint;
  v_status text;
  v_paid bigint;
  v_credit bigint;
  v_tds bigint;
  v_new text;
begin
  select i.total_paise, i.status into v_total, v_status
    from public.invoices i where i.id = p_invoice and i.org_id = p_org for update;
  if v_total is null then return; end if;
  select coalesce(sum(a.amount_paise), 0) into v_paid
    from public.allocations a where a.invoice_id = p_invoice and a.org_id = p_org;
  select coalesce(sum(n.total_paise), 0) into v_credit
    from public.notes n
    where n.invoice_id = p_invoice and n.org_id = p_org and n.note_type = 'credit' and n.status = 'issued';
  select coalesce(sum(t.amount_paise), 0) into v_tds
    from public.tds_entries t where t.invoice_id = p_invoice and t.org_id = p_org;
  if v_paid > v_total then
    raise exception 'allocations exceed invoice total' using errcode = '23514';
  end if;
  v_credit := least(v_credit, v_total);
  v_tds := least(v_tds, v_total);
  v_new := case
    when v_status in ('draft', 'void') then v_status
    when v_total > 0 and v_paid + v_credit + v_tds >= v_total then 'paid'
    when v_paid + v_tds > 0 then 'partially_paid'
    else 'issued' end;
  update public.invoices set paid_paise = v_paid, credited_paise = v_credit, tds_paise = v_tds, status = v_new
    where id = p_invoice and org_id = p_org
      and (paid_paise, credited_paise, tds_paise, status) is distinct from (v_paid, v_credit, v_tds, v_new);
end $$;

revoke execute on function app.refresh_invoice(uuid, uuid) from public, anon, authenticated;

create or replace function app.sync_allocation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_invoice uuid;
  v_org uuid;
  v_payment uuid;
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
    perform app.refresh_invoice(v_invoice, v_org);
    select coalesce(sum(a.amount_paise), 0) into v_alloc
      from public.allocations a where a.payment_id = v_payment and a.org_id = v_org;
    select p.amount_paise into v_pay_amount
      from public.payments p where p.id = v_payment and p.org_id = v_org;
    if v_pay_amount is not null and v_alloc > v_pay_amount then
      raise exception 'allocations exceed payment amount' using errcode = '23514';
    end if;
  end loop;
  return null;
end $$;

create function app.sync_credit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform app.refresh_invoice(new.invoice_id, new.org_id);
  end if;
  if tg_op in ('DELETE', 'UPDATE') then
    perform app.refresh_invoice(old.invoice_id, old.org_id);
  end if;
  return null;
end $$;

create trigger notes_sync_credit after insert or update or delete on public.notes
  for each row execute function app.sync_credit();

create function app.sync_tds() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('INSERT', 'UPDATE') and new.invoice_id is not null then
    perform app.refresh_invoice(new.invoice_id, new.org_id);
  end if;
  if tg_op in ('DELETE', 'UPDATE') and old.invoice_id is not null then
    perform app.refresh_invoice(old.invoice_id, old.org_id);
  end if;
  return null;
end $$;

create trigger tds_entries_sync_invoice after insert or update or delete on public.tds_entries
  for each row execute function app.sync_tds();

-- ---------------------------------------------------------------------------
-- Buyer claims ("I've already paid") and owner replies.
-- ---------------------------------------------------------------------------
create table public.payment_claims (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  invoice_id uuid not null,
  customer_id uuid,
  reference text,
  paid_on date,
  amount_paise bigint check (amount_paise > 0),
  note text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  owner_reply text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (invoice_id, org_id) references public.invoices (id, org_id),
  foreign key (customer_id, org_id) references public.customers (id, org_id)
);
create index payment_claims_org_status_idx on public.payment_claims (org_id, status, created_at desc);
create index payment_claims_org_invoice_idx on public.payment_claims (org_id, invoice_id);

alter table public.disputes add column owner_reply text;
alter table public.promises add column note text;

alter table public.payment_claims enable row level security;
create policy payment_claims_select on public.payment_claims for select to authenticated
  using (app.is_member(org_id));
create policy payment_claims_insert on public.payment_claims for insert to authenticated
  with check (app.can_write(org_id));
create policy payment_claims_update on public.payment_claims for update to authenticated
  using (app.can_write(org_id)) with check (app.can_write(org_id));
create policy payment_claims_delete on public.payment_claims for delete to authenticated
  using (app.can_write(org_id));

create trigger payment_claims_before_update before update on public.payment_claims
  for each row execute function app.before_update();
create trigger payment_claims_audit after insert or update or delete on public.payment_claims
  for each row execute function app.audit_row();

-- ---------------------------------------------------------------------------
-- TDS: more sections, quarter + 26AS matching.
-- ---------------------------------------------------------------------------
alter table public.tds_entries drop constraint if exists tds_entries_section_check;
alter table public.tds_entries add constraint tds_entries_section_check
  check (section in ('194C', '194H', '194I', '194J', '194O', '194Q', 'GST_TDS', 'GST_TCS', 'other'));
alter table public.tds_entries
  add column claimed_in_26as boolean not null default false,
  add column claimed_at timestamptz,
  add column taxable_paise bigint check (taxable_paise >= 0);
create index tds_entries_org_deducted_idx on public.tds_entries (org_id, deducted_on);

-- ---------------------------------------------------------------------------
-- Rate limiting for public endpoints (service role only).
-- ---------------------------------------------------------------------------
create table public.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  hits int not null default 0
);
alter table public.rate_limits enable row level security;

create function public.rate_limit_hit(p_key text, p_max int, p_window_seconds int) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_hits int;
begin
  insert into public.rate_limits as r (key, window_start, hits)
    values (p_key, now(), 1)
    on conflict (key) do update set
      window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds)
                          then now() else r.window_start end,
      hits = case when r.window_start < now() - make_interval(secs => p_window_seconds)
                  then 1 else r.hits + 1 end
    returning hits into v_hits;
  return v_hits <= p_max;
end $$;

revoke execute on function public.rate_limit_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;

-- ---------------------------------------------------------------------------
-- Public pay view: only the invoice a token points at, only public fields.
-- Called by the get-pay-view edge function with the service role.
-- ---------------------------------------------------------------------------
create function app.token_invoice(p_token text) returns table (invoice_id uuid, org_id uuid, token_id uuid)
language sql security definer set search_path = '' stable as $$
  select t.invoice_id, t.org_id, t.id from public.pay_tokens t
  where t.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and t.expires_at > now() and t.revoked_at is null
$$;
revoke execute on function app.token_invoice(text) from public, anon, authenticated;

create function public.pay_view(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_inv uuid;
  v_org uuid;
  v_tok uuid;
  r jsonb;
begin
  select ti.invoice_id, ti.org_id, ti.token_id into v_inv, v_org, v_tok from app.token_invoice(p_token) ti;
  if v_inv is null then
    return null;
  end if;
  update public.pay_tokens set used_at = coalesce(used_at, now()) where id = v_tok;
  select jsonb_build_object(
    'business_name', coalesce(nullif(bp.trade_name, ''), bp.legal_name),
    'business_phone', bp.phone,
    'business_email', bp.email,
    'upi_id', bp.upi_id,
    'invoice_id', i.id,
    'invoice_number', i.number,
    'invoice_type', i.invoice_type,
    'issue_date', i.issue_date,
    'due_date', i.due_date,
    'total_paise', i.total_paise,
    'paid_paise', i.paid_paise,
    'credited_paise', i.credited_paise,
    'tds_paise', i.tds_paise,
    'balance_paise', i.balance_paise,
    'status', i.status,
    'reverse_charge', i.reverse_charge,
    'accepted_on', i.accepted_on,
    'cgst_paise', i.cgst_paise, 'sgst_paise', i.sgst_paise, 'igst_paise', i.igst_paise,
    'razorpay_link_url', i.razorpay_link_url,
    'customer_name', c.name,
    'language', c.language,
    'lens_facts', jsonb_build_object(
      'seller', jsonb_build_object('udyam_number', bp.udyam_number, 'enterprise_size', bp.enterprise_size, 'activity', bp.activity),
      'buyer', jsonb_build_object('gstin', c.gstin, 'entity_type', c.entity_type, 'presumptive_tax', c.presumptive_tax,
                                  'credit_days', c.credit_days, 'has_written_agreement', c.has_written_agreement)
    ),
    'open_dispute', exists (select 1 from public.disputes d where d.invoice_id = i.id and d.org_id = i.org_id and d.status = 'open'),
    'pending_claim', exists (select 1 from public.payment_claims pc where pc.invoice_id = i.id and pc.org_id = i.org_id and pc.status = 'pending')
  ) into r
  from public.invoices i
  join public.customers c on c.id = i.customer_id and c.org_id = i.org_id
  join public.business_profile bp on bp.org_id = i.org_id
  where i.id = v_inv and i.org_id = v_org and i.status <> 'draft';
  return r;
end $$;
revoke execute on function public.pay_view(text) from public, anon, authenticated;
grant execute on function public.pay_view(text) to service_role;

-- Buyer actions through the link. kind: paid | dispute | promise.
create function public.pay_action(p_token text, p_kind text, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_inv uuid;
  v_org uuid;
  v_cust uuid;
  v_id uuid;
  v_date date;
  v_status text;
begin
  select ti.invoice_id, ti.org_id into v_inv, v_org from app.token_invoice(p_token) ti;
  if v_inv is null then
    raise exception 'invalid or expired link' using errcode = '42501';
  end if;
  select i.customer_id, i.status into v_cust, v_status from public.invoices i where i.id = v_inv and i.org_id = v_org;
  if v_status in ('draft', 'void') then
    raise exception 'invoice not payable' using errcode = '42501';
  end if;
  if p_kind = 'paid' then
    v_date := nullif(p_payload ->> 'paid_on', '')::date;
    if v_date is null or v_date > (now() at time zone 'Asia/Kolkata')::date then
      raise exception 'paid_on must be a past or current date' using errcode = '22023';
    end if;
    insert into public.payment_claims (org_id, invoice_id, customer_id, reference, paid_on, note)
      values (v_org, v_inv, v_cust, left(nullif(trim(p_payload ->> 'reference'), ''), 200), v_date, left(p_payload ->> 'note', 1000))
      returning id into v_id;
  elsif p_kind = 'dispute' then
    if coalesce(trim(p_payload ->> 'reason'), '') = '' then
      raise exception 'reason required' using errcode = '22023';
    end if;
    insert into public.disputes (org_id, invoice_id, customer_id, reason, raised_via)
      values (v_org, v_inv, v_cust,
              left(trim(p_payload ->> 'reason') || coalesce(E'\n' || nullif(trim(p_payload ->> 'note'), ''), ''), 2000), 'portal')
      returning id into v_id;
  elsif p_kind = 'promise' then
    v_date := nullif(p_payload ->> 'date', '')::date;
    if v_date is null or v_date < (now() at time zone 'Asia/Kolkata')::date
       or v_date > (now() at time zone 'Asia/Kolkata')::date + 120 then
      raise exception 'promise date must be within the next 120 days' using errcode = '22023';
    end if;
    insert into public.promises (org_id, invoice_id, customer_id, promised_for, source)
      values (v_org, v_inv, v_cust, v_date, 'portal')
      returning id into v_id;
  else
    raise exception 'unknown action' using errcode = '22023';
  end if;
  return v_id;
end $$;
revoke execute on function public.pay_action(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.pay_action(text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Gateway payments: idempotent on the gateway payment id. Service role (webhook) only.
-- ---------------------------------------------------------------------------
create function public.record_gateway_payment(
  p_invoice uuid, p_amount bigint, p_gateway_payment_id text, p_paid_on date default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_cust uuid;
  v_total bigint;
  v_payment uuid;
  v_alloc bigint;
begin
  select i.org_id, i.customer_id, i.balance_paise
    into v_org, v_cust, v_total
    from public.invoices i where i.id = p_invoice for update;
  if v_org is null then
    raise exception 'invoice not found' using errcode = 'P0002';
  end if;
  select p.id into v_payment from public.payments p
    where p.org_id = v_org and p.razorpay_payment_id = p_gateway_payment_id;
  if v_payment is not null then
    return jsonb_build_object('payment_id', v_payment, 'duplicate', true);
  end if;
  insert into public.payments (org_id, customer_id, amount_paise, received_on, method, reference, status, source,
                               razorpay_payment_id, idempotency_key)
    values (v_org, v_cust, p_amount, coalesce(p_paid_on, (now() at time zone 'Asia/Kolkata')::date),
            'razorpay', p_gateway_payment_id, 'confirmed', 'razorpay', p_gateway_payment_id, 'rzp:' || p_gateway_payment_id)
    on conflict (org_id, razorpay_payment_id) where razorpay_payment_id is not null do nothing
    returning id into v_payment;
  if v_payment is null then
    select p.id into v_payment from public.payments p
      where p.org_id = v_org and p.razorpay_payment_id = p_gateway_payment_id;
    return jsonb_build_object('payment_id', v_payment, 'duplicate', true);
  end if;
  v_alloc := least(p_amount, v_total);
  if v_alloc > 0 then
    insert into public.allocations (org_id, payment_id, invoice_id, amount_paise)
      values (v_org, v_payment, p_invoice, v_alloc);
  end if;
  return jsonb_build_object('payment_id', v_payment, 'duplicate', false, 'allocated_paise', v_alloc,
                            'unallocated_paise', p_amount - v_alloc);
end $$;
revoke execute on function public.record_gateway_payment(uuid, bigint, text, date) from public, anon, authenticated;
grant execute on function public.record_gateway_payment(uuid, bigint, text, date) to service_role;

-- ---------------------------------------------------------------------------
-- Bank reconciliation: owner confirms a suggestion. One transaction: payment, allocations,
-- optional TDS entry, bank line marked matched. Idempotent per bank txn.
-- p_alloc: [{invoice_id, amount_paise}], p_tds: {section, rate, amount_paise, invoice_id, taxable_paise} or null.
-- ---------------------------------------------------------------------------
create function public.confirm_bank_match(p_org uuid, p_txn uuid, p_customer uuid, p_alloc jsonb, p_tds jsonb)
returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_txn public.bank_txns;
  v_payment uuid;
  v_item jsonb;
  v_sum bigint := 0;
begin
  select * into v_txn from public.bank_txns where id = p_txn and org_id = p_org for update;
  if v_txn.id is null then
    raise exception 'bank line not found' using errcode = 'P0002';
  end if;
  if v_txn.status = 'matched' then
    return v_txn.matched_payment_id;
  end if;
  if v_txn.direction <> 'credit' then
    raise exception 'only credits can be matched' using errcode = '22023';
  end if;
  for v_item in select * from jsonb_array_elements(coalesce(p_alloc, '[]'::jsonb)) loop
    v_sum := v_sum + (v_item ->> 'amount_paise')::bigint;
  end loop;
  if v_sum > v_txn.amount_paise then
    raise exception 'allocations exceed the deposit' using errcode = '23514';
  end if;
  insert into public.payments (org_id, customer_id, amount_paise, received_on, method, reference, status, source, idempotency_key)
    values (p_org, p_customer, v_txn.amount_paise, v_txn.txn_date, 'bank_transfer', v_txn.reference, 'confirmed', 'bank_import', 'bank:' || v_txn.id)
    returning id into v_payment;
  for v_item in select * from jsonb_array_elements(coalesce(p_alloc, '[]'::jsonb)) loop
    insert into public.allocations (org_id, payment_id, invoice_id, amount_paise)
      values (p_org, v_payment, (v_item ->> 'invoice_id')::uuid, (v_item ->> 'amount_paise')::bigint);
  end loop;
  if p_tds is not null and (p_tds ->> 'amount_paise')::bigint > 0 then
    insert into public.tds_entries (org_id, customer_id, invoice_id, payment_id, section, rate, amount_paise,
                                    taxable_paise, deducted_on, financial_year, certificate_status)
      values (p_org, p_customer, nullif(p_tds ->> 'invoice_id', '')::uuid, v_payment, p_tds ->> 'section',
              (p_tds ->> 'rate')::numeric, (p_tds ->> 'amount_paise')::bigint,
              nullif(p_tds ->> 'taxable_paise', '')::bigint, v_txn.txn_date,
              to_char(case when extract(month from v_txn.txn_date) >= 4 then v_txn.txn_date else v_txn.txn_date - interval '1 year' end, 'YY')
                || '-' || to_char(case when extract(month from v_txn.txn_date) >= 4 then v_txn.txn_date + interval '1 year' else v_txn.txn_date end, 'YY'),
              'pending');
  end if;
  update public.bank_txns set status = 'matched', matched_payment_id = v_payment where id = p_txn and org_id = p_org;
  return v_payment;
end $$;
revoke execute on function public.confirm_bank_match(uuid, uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.confirm_bank_match(uuid, uuid, uuid, jsonb, jsonb) to authenticated;
