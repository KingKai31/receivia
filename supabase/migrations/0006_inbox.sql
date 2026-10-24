-- S4 inbox: owner resolves buyer claims and disputes; replies are visible on the pay page.

-- One manual payment against one invoice, atomically. Security invoker: RLS decides who may.
create function public.record_manual_payment(
  p_org uuid, p_invoice uuid, p_amount bigint, p_method text, p_reference text, p_date date
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_cust uuid;
  v_balance bigint;
  v_payment uuid;
  v_alloc bigint;
begin
  select i.customer_id, i.balance_paise into v_cust, v_balance
    from public.invoices i where i.id = p_invoice and i.org_id = p_org for update;
  if v_cust is null then
    raise exception 'invoice not found' using errcode = 'P0002';
  end if;
  if p_amount <= 0 then
    raise exception 'amount must be positive' using errcode = '22023';
  end if;
  insert into public.payments (org_id, customer_id, amount_paise, received_on, method, reference, status, source)
    values (p_org, v_cust, p_amount, coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date), p_method,
            left(p_reference, 200), 'confirmed', 'manual')
    returning id into v_payment;
  v_alloc := least(p_amount, v_balance);
  if v_alloc > 0 then
    insert into public.allocations (org_id, payment_id, invoice_id, amount_paise) values (p_org, v_payment, p_invoice, v_alloc);
  end if;
  return v_payment;
end $$;
revoke execute on function public.record_manual_payment(uuid, uuid, bigint, text, text, date) from public, anon;
grant execute on function public.record_manual_payment(uuid, uuid, bigint, text, text, date) to authenticated;

-- Accept ("yes, it was paid": records the payment for the claimed or full balance) or reject with a reply.
create function public.resolve_claim(p_org uuid, p_claim uuid, p_accept boolean, p_reply text, p_amount bigint default null)
returns void
language plpgsql security invoker set search_path = '' as $$
declare
  c public.payment_claims;
  v_balance bigint;
begin
  select * into c from public.payment_claims where id = p_claim and org_id = p_org for update;
  if c.id is null then
    raise exception 'claim not found' using errcode = 'P0002';
  end if;
  if c.status <> 'pending' then
    return;
  end if;
  if p_accept then
    select i.balance_paise into v_balance from public.invoices i where i.id = c.invoice_id and i.org_id = p_org;
    if coalesce(p_amount, v_balance) > 0 and v_balance > 0 then
      perform public.record_manual_payment(p_org, c.invoice_id, least(coalesce(p_amount, v_balance), v_balance),
                                           'other', coalesce(c.reference, 'Buyer claim'), c.paid_on);
    end if;
  elsif coalesce(trim(p_reply), '') = '' then
    raise exception 'a reply is required when rejecting' using errcode = '22023';
  end if;
  update public.payment_claims
    set status = case when p_accept then 'accepted' else 'rejected' end,
        owner_reply = left(nullif(trim(p_reply), ''), 1000), resolved_at = now()
    where id = p_claim and org_id = p_org;
end $$;
revoke execute on function public.resolve_claim(uuid, uuid, boolean, text, bigint) from public, anon;
grant execute on function public.resolve_claim(uuid, uuid, boolean, text, bigint) to authenticated;

-- Dispute outcomes: credit_note / paid / rejected. The reminder ladder resumes when the flag clears.
create function public.resolve_dispute(p_org uuid, p_dispute uuid, p_outcome text, p_reply text)
returns void
language plpgsql security invoker set search_path = '' as $$
declare
  d public.disputes;
  v_balance bigint;
begin
  if p_outcome not in ('credit_note', 'paid', 'rejected') then
    raise exception 'unknown outcome' using errcode = '22023';
  end if;
  select * into d from public.disputes where id = p_dispute and org_id = p_org for update;
  if d.id is null then
    raise exception 'dispute not found' using errcode = 'P0002';
  end if;
  if d.status <> 'open' then
    return;
  end if;
  if p_outcome = 'rejected' and coalesce(trim(p_reply), '') = '' then
    raise exception 'a reply is required when rejecting' using errcode = '22023';
  end if;
  if p_outcome = 'paid' then
    select i.balance_paise into v_balance from public.invoices i where i.id = d.invoice_id and i.org_id = p_org;
    if v_balance > 0 then
      perform public.record_manual_payment(p_org, d.invoice_id, v_balance, 'other', 'Settled after dispute', null);
    end if;
  end if;
  update public.disputes
    set status = case when p_outcome = 'rejected' then 'rejected' else 'resolved' end,
        resolution_note = case p_outcome when 'credit_note' then 'Credit note' when 'paid' then 'Marked paid' else 'Rejected' end,
        owner_reply = left(nullif(trim(p_reply), ''), 1000), resolved_at = now()
    where id = p_dispute and org_id = p_org;
end $$;
revoke execute on function public.resolve_dispute(uuid, uuid, text, text) from public, anon;
grant execute on function public.resolve_dispute(uuid, uuid, text, text) to authenticated;

-- Pay view now also carries the owner's replies so the buyer sees the answer.
create or replace function public.pay_view(p_token text) returns jsonb
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
    'pending_claim', exists (select 1 from public.payment_claims pc where pc.invoice_id = i.id and pc.org_id = i.org_id and pc.status = 'pending'),
    'replies', coalesce((
      select jsonb_agg(x.reply order by x.at desc) from (
        select d.owner_reply as reply, d.resolved_at as at from public.disputes d
          where d.invoice_id = i.id and d.org_id = i.org_id and d.owner_reply is not null
        union all
        select pc.owner_reply, pc.resolved_at from public.payment_claims pc
          where pc.invoice_id = i.id and pc.org_id = i.org_id and pc.owner_reply is not null
        order by at desc limit 3
      ) x
    ), '[]'::jsonb)
  ) into r
  from public.invoices i
  join public.customers c on c.id = i.customer_id and c.org_id = i.org_id
  join public.business_profile bp on bp.org_id = i.org_id
  where i.id = v_inv and i.org_id = v_org and i.status <> 'draft';
  return r;
end $$;
