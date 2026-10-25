-- S15: buyer negotiation agent on /pay/:token. The model proposes; these functions decide.
-- Every limit lives here (owner settings on business_profile); the model can only call neg_apply.

alter table public.business_profile
  add column neg_enabled boolean not null default false,
  add column neg_max_discount_pct numeric(4, 2) not null default 2 check (neg_max_discount_pct between 0 and 10),
  add column neg_max_instalments int not null default 3 check (neg_max_instalments between 2 and 4),
  add column neg_max_promise_days int not null default 30 check (neg_max_promise_days between 1 and 120);

-- Every chat turn and tool call (audited by the standard trigger as well).
create table public.negotiation_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  invoice_id uuid not null,
  customer_id uuid,
  role text not null check (role in ('buyer', 'assistant', 'tool')),
  tool text,
  content text not null check (length(content) <= 4000),
  payload jsonb,
  ok boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (invoice_id, org_id) references public.invoices (id, org_id),
  foreign key (customer_id, org_id) references public.customers (id, org_id)
);
create index negotiation_log_inv_idx on public.negotiation_log (org_id, invoice_id, created_at desc);

-- An early-payment discount the agent offered; the owner sees it in the Inbox.
create table public.discount_offers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  invoice_id uuid not null,
  customer_id uuid,
  discount_pct numeric(4, 2) not null check (discount_pct > 0),
  discount_paise bigint not null check (discount_paise > 0),
  pay_by date not null,
  status text not null default 'offered' check (status in ('offered', 'taken', 'expired', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (invoice_id, org_id) references public.invoices (id, org_id),
  foreign key (customer_id, org_id) references public.customers (id, org_id)
);
create index discount_offers_org_idx on public.discount_offers (org_id, status, created_at desc);

do $$
declare
  t text;
begin
  foreach t in array array['negotiation_log', 'discount_offers'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (org_id in (select app.org_ids()))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (org_id in (select app.writer_org_ids()))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (org_id in (select app.writer_org_ids())) with check (org_id in (select app.writer_org_ids()))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (org_id in (select app.writer_org_ids()))', t || '_delete', t);
    execute format('create trigger %I before update on public.%I for each row execute function app.before_update()', t || '_before_update', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_row()', t || '_audit', t);
  end loop;
end $$;

-- Facts and limits for the chat. Service role only.
create function public.neg_context(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_inv uuid;
  v_org uuid;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select ti.invoice_id, ti.org_id into v_inv, v_org from app.token_invoice(p_token) ti;
  if v_inv is null then
    raise exception 'invalid or expired link' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'enabled', bp.neg_enabled,
      'max_discount_pct', bp.neg_max_discount_pct,
      'max_instalments', bp.neg_max_instalments,
      'max_promise_days', bp.neg_max_promise_days,
      'today', v_today,
      'business', coalesce(bp.legal_name, 'the seller'),
      'invoice', jsonb_build_object(
        'number', i.number, 'issue_date', i.issue_date, 'due_date', i.due_date,
        'total_paise', i.total_paise, 'paid_paise', i.paid_paise, 'balance_paise', i.balance_paise,
        'status', i.status, 'days_overdue', greatest(v_today - i.due_date, 0)),
      'history', (select coalesce(jsonb_agg(jsonb_build_object('role', h.role, 'content', h.content) order by h.created_at), '[]'::jsonb)
                  from (select * from public.negotiation_log l
                         where l.invoice_id = v_inv and l.org_id = v_org and l.role in ('buyer', 'assistant')
                         order by l.created_at desc limit 12) h)
    )
    from public.invoices i join public.business_profile bp on bp.org_id = i.org_id
    where i.id = v_inv and i.org_id = v_org
  );
end $$;
revoke execute on function public.neg_context(text) from public, anon, authenticated;
grant execute on function public.neg_context(text) to service_role;

-- One chat turn (buyer or assistant text). Service role only.
create function public.neg_log(p_token text, p_role text, p_content text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_inv uuid;
  v_org uuid;
  v_cust uuid;
begin
  select ti.invoice_id, ti.org_id into v_inv, v_org from app.token_invoice(p_token) ti;
  if v_inv is null then
    raise exception 'invalid or expired link' using errcode = '42501';
  end if;
  if p_role not in ('buyer', 'assistant') then
    raise exception 'bad role' using errcode = '22023';
  end if;
  select customer_id into v_cust from public.invoices where id = v_inv and org_id = v_org;
  insert into public.negotiation_log (org_id, invoice_id, customer_id, role, content)
    values (v_org, v_inv, v_cust, p_role, left(coalesce(p_content, ''), 4000));
end $$;
revoke execute on function public.neg_log(text, text, text) from public, anon, authenticated;
grant execute on function public.neg_log(text, text, text) to service_role;

-- The only way the agent changes anything. Validates against the owner's limits and returns
-- {ok, message, ...}; a refusal is a normal result the model can explain, never an exception.
create function public.neg_apply(p_token text, p_tool text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_inv uuid;
  v_org uuid;
  inv public.invoices;
  bp public.business_profile;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_res jsonb;
  v_n int;
  v_date date;
  v_pct numeric;
  v_amt bigint;
  v_plan uuid;
  v_disc bigint;
  v_each bigint;
  v_items jsonb := '[]'::jsonb;
  v_reason text;
  k int;
begin
  select ti.invoice_id, ti.org_id into v_inv, v_org from app.token_invoice(p_token) ti;
  if v_inv is null then
    raise exception 'invalid or expired link' using errcode = '42501';
  end if;
  select * into inv from public.invoices where id = v_inv and org_id = v_org for update;
  select * into bp from public.business_profile where org_id = v_org;
  if not bp.neg_enabled then
    v_res := jsonb_build_object('ok', false, 'message', 'The seller has not enabled this assistant. Please use the buttons on the page.');
  elsif inv.status in ('draft', 'void') then
    v_res := jsonb_build_object('ok', false, 'message', 'This invoice cannot be discussed.');
  elsif p_tool = 'answer_invoice_question' then
    v_res := jsonb_build_object('ok', true, 'message', 'Facts',
      'invoice_number', inv.number, 'issue_date', inv.issue_date, 'due_date', inv.due_date,
      'total_paise', inv.total_paise, 'paid_paise', inv.paid_paise, 'balance_paise', inv.balance_paise,
      'status', inv.status,
      'options', jsonb_build_object('max_instalments', bp.neg_max_instalments,
        'max_discount_pct', bp.neg_max_discount_pct, 'max_promise_days', bp.neg_max_promise_days));
  elsif inv.balance_paise <= 0 then
    v_res := jsonb_build_object('ok', false, 'message', 'Nothing is owed on this invoice.');
  elsif p_tool = 'offer_instalments' then
    begin
      v_n := (p_args ->> 'count')::int;
      v_date := (p_args ->> 'first_date')::date;
    exception when others then
      v_n := null; v_date := null;
    end;
    if v_n is null or v_n < 2 or v_n > bp.neg_max_instalments then
      v_res := jsonb_build_object('ok', false, 'message', 'Instalments must be between 2 and ' || bp.neg_max_instalments || '.');
    elsif v_date is null or v_date < v_today or v_date + 14 * (v_n - 1) > v_today + bp.neg_max_promise_days then
      v_res := jsonb_build_object('ok', false, 'message', 'The first date must be today or later, and the last instalment (every 14 days) must fall within ' || bp.neg_max_promise_days || ' days from today.');
    elsif exists (select 1 from public.instalment_plans p where p.invoice_id = v_inv and p.org_id = v_org and p.status in ('requested', 'approved')) then
      v_res := jsonb_build_object('ok', false, 'message', 'A payment plan already exists for this invoice.');
    else
      v_each := inv.balance_paise / v_n;
      for k in 1..v_n loop
        v_items := v_items || jsonb_build_object('seq', k, 'date', v_date + 14 * (k - 1),
          'amount_paise', case when k = v_n then inv.balance_paise - v_each * (v_n - 1) else v_each end);
      end loop;
      insert into public.instalment_plans (org_id, invoice_id, customer_id, total_paise)
        values (v_org, v_inv, inv.customer_id, inv.balance_paise) returning id into v_plan;
      insert into public.instalments (org_id, plan_id, seq, due_on, amount_paise)
        select v_org, v_plan, (e ->> 'seq')::int, (e ->> 'date')::date, (e ->> 'amount_paise')::bigint
        from jsonb_array_elements(v_items) e;
      v_res := jsonb_build_object('ok', true, 'message', 'Plan sent to the seller for approval. It is not final until they approve.',
        'items', v_items, 'status', 'requested');
    end if;
  elsif p_tool = 'offer_early_pay_discount' then
    begin
      v_pct := (p_args ->> 'pct')::numeric;
      v_date := (p_args ->> 'pay_by')::date;
    exception when others then
      v_pct := null; v_date := null;
    end;
    if v_pct is null or v_pct <= 0 or v_pct > bp.neg_max_discount_pct then
      v_res := jsonb_build_object('ok', false, 'message', 'The most the seller allows is ' || bp.neg_max_discount_pct || '% for early payment.');
    elsif v_date is null or v_date < v_today or v_date > v_today + least(bp.neg_max_promise_days, 14) then
      v_res := jsonb_build_object('ok', false, 'message', 'The pay-by date must be within ' || least(bp.neg_max_promise_days, 14) || ' days from today.');
    else
      v_disc := round(inv.balance_paise * v_pct / 100);
      if v_disc <= 0 then
        v_res := jsonb_build_object('ok', false, 'message', 'The discount would be too small to offer.');
      else
        update public.discount_offers set status = 'cancelled' where invoice_id = v_inv and org_id = v_org and status = 'offered';
        insert into public.discount_offers (org_id, invoice_id, customer_id, discount_pct, discount_paise, pay_by)
          values (v_org, v_inv, inv.customer_id, v_pct, v_disc, v_date);
        v_res := jsonb_build_object('ok', true, 'message', 'Discount offered if paid in full by the date. The seller has been told.',
          'discount_pct', v_pct, 'discount_paise', v_disc, 'pay_paise', inv.balance_paise - v_disc, 'pay_by', v_date);
      end if;
    end if;
  elsif p_tool = 'record_promise' then
    begin
      v_date := (p_args ->> 'date')::date;
      v_amt := coalesce(nullif(p_args ->> 'amount_paise', '')::bigint, inv.balance_paise);
    exception when others then
      v_date := null; v_amt := null;
    end;
    if v_date is null or v_date < v_today or v_date > v_today + bp.neg_max_promise_days then
      v_res := jsonb_build_object('ok', false, 'message', 'A promise date must be within ' || bp.neg_max_promise_days || ' days from today.');
    elsif v_amt is null or v_amt <= 0 or v_amt > inv.balance_paise then
      v_res := jsonb_build_object('ok', false, 'message', 'The promised amount must be more than zero and not more than what is owed.');
    else
      insert into public.promises (org_id, invoice_id, customer_id, promised_amount_paise, promised_for, source, note)
        values (v_org, v_inv, inv.customer_id, v_amt, v_date, 'portal', 'Agreed in chat');
      v_res := jsonb_build_object('ok', true, 'message', 'Promise recorded.', 'date', v_date, 'amount_paise', v_amt);
    end if;
  elsif p_tool = 'raise_dispute' then
    v_reason := left(trim(coalesce(p_args ->> 'reason', '')), 1000);
    if v_reason = '' then
      v_res := jsonb_build_object('ok', false, 'message', 'A reason is needed to raise a dispute.');
    else
      insert into public.disputes (org_id, invoice_id, customer_id, reason, raised_via)
        values (v_org, v_inv, inv.customer_id, v_reason, 'portal');
      v_res := jsonb_build_object('ok', true, 'message', 'Dispute raised. Reminders for this invoice are paused and the seller has been told.');
    end if;
  else
    v_res := jsonb_build_object('ok', false, 'message', 'Unknown action.');
  end if;
  insert into public.negotiation_log (org_id, invoice_id, customer_id, role, tool, content, payload, ok)
    values (v_org, v_inv, inv.customer_id, 'tool', left(p_tool, 60), left(v_res ->> 'message', 4000),
            jsonb_build_object('args', p_args, 'result', v_res), (v_res ->> 'ok')::boolean);
  return v_res;
end $$;
revoke execute on function public.neg_apply(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.neg_apply(text, text, jsonb) to service_role;
