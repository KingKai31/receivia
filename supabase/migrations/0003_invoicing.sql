-- Receivia 0003: invoicing. Drafts are unnumbered; numbers are assigned atomically at issue.

alter table public.invoices alter column number drop not null;
alter table public.invoices
  add column reverse_charge boolean not null default false,
  add column delivery_address text,
  add column disputed boolean not null default false,
  add constraint invoices_number_when_issued check (status in ('draft', 'void') or number is not null);

alter table public.notes alter column number drop not null;
alter table public.notes
  add constraint notes_number_when_issued check (status in ('draft', 'void') or number is not null);

-- Counters become per series so credit and debit notes number independently of invoices.
alter table public.invoice_counters add column series text not null default 'INV'
  check (series in ('INV', 'CN', 'DN'));
alter table public.invoice_counters drop constraint invoice_counters_org_id_fy_key;
alter table public.invoice_counters add constraint invoice_counters_org_fy_series_key unique (org_id, fy, series);

create or replace function public.next_invoice_number(p_org uuid, p_fy text) returns text
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
  insert into public.invoice_counters as c (org_id, fy, series, last_seq)
  values (p_org, p_fy, 'INV', 1)
  on conflict (org_id, fy, series) do update set last_seq = c.last_seq + 1, updated_at = now()
  returning c.last_seq into v_seq;
  v_number := v_prefix || '/' || p_fy || '/' || lpad(v_seq::text, 4, '0');
  if length(v_number) > 16 then
    raise exception 'invoice number too long: %', v_number using errcode = '22001';
  end if;
  return v_number;
end $$;

create function public.next_note_number(p_org uuid, p_fy text, p_type text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_series text;
  v_seq int;
begin
  if not app.can_write(p_org) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_fy is null or p_fy !~ '^[0-9]{2}-[0-9]{2}$' then
    raise exception 'invalid financial year %', p_fy using errcode = '22023';
  end if;
  v_series := case p_type when 'credit' then 'CN' when 'debit' then 'DN'
    else null end;
  if v_series is null then
    raise exception 'invalid note type %', p_type using errcode = '22023';
  end if;
  insert into public.invoice_counters as c (org_id, fy, series, last_seq)
  values (p_org, p_fy, v_series, 1)
  on conflict (org_id, fy, series) do update set last_seq = c.last_seq + 1, updated_at = now()
  returning c.last_seq into v_seq;
  return v_series || '/' || p_fy || '/' || lpad(v_seq::text, 4, '0');
end $$;

-- Assigns the number and flips draft -> issued in one transaction, so a failed issue never burns a number.
create function public.issue_invoice(p_invoice uuid, p_expected timestamptz) returns public.invoices
language plpgsql security definer set search_path = '' as $$
declare
  v public.invoices;
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
  update public.invoices
     set number = public.next_invoice_number(v.org_id, v.fy), status = 'issued'
   where id = p_invoice
   returning * into v;
  return v;
end $$;

create function public.issue_note(p_note uuid, p_expected timestamptz) returns public.notes
language plpgsql security definer set search_path = '' as $$
declare
  v public.notes;
  v_fy text;
begin
  select * into v from public.notes where id = p_note for update;
  if not found or not app.can_write(v.org_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v.updated_at <> p_expected then
    raise exception 'conflict' using errcode = '40001';
  end if;
  if v.status <> 'draft' then
    raise exception 'note is not a draft' using errcode = '22023';
  end if;
  v_fy := case when extract(month from v.issue_date) >= 4
    then to_char(v.issue_date, 'YY') || '-' || lpad(((extract(year from v.issue_date)::int + 1) % 100)::text, 2, '0')
    else lpad(((extract(year from v.issue_date)::int - 1) % 100)::text, 2, '0') || '-' || to_char(v.issue_date, 'YY')
  end;
  update public.notes
     set number = public.next_note_number(v.org_id, v_fy, v.note_type), status = 'issued'
   where id = p_note
   returning * into v;
  return v;
end $$;

revoke execute on function public.next_note_number(uuid, text, text) from public, anon;
revoke execute on function public.issue_invoice(uuid, timestamptz) from public, anon;
revoke execute on function public.issue_note(uuid, timestamptz) from public, anon;
grant execute on function public.next_note_number(uuid, text, text) to authenticated;
grant execute on function public.issue_invoice(uuid, timestamptz) to authenticated;
grant execute on function public.issue_note(uuid, timestamptz) to authenticated;

create index invoices_org_number_idx on public.invoices (org_id, number);

-- Atomic create/update of a draft invoice with its lines. Security invoker: RLS applies.
-- p_id null creates; otherwise the draft is updated only if updated_at still equals p_expected.
create function public.save_invoice(
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
      notes, reverse_charge, delivery_address
    ) values (
      p_org, (p_header ->> 'customer_id')::uuid, p_header ->> 'fy', p_header ->> 'invoice_type', 'draft',
      (p_header ->> 'issue_date')::date, (p_header ->> 'due_date')::date,
      p_header ->> 'supplier_state_code', p_header ->> 'place_of_supply',
      (p_header ->> 'taxable_paise')::bigint, (p_header ->> 'cgst_paise')::bigint,
      (p_header ->> 'sgst_paise')::bigint, (p_header ->> 'igst_paise')::bigint,
      (p_header ->> 'round_off_paise')::bigint, (p_header ->> 'total_paise')::bigint,
      p_header ->> 'notes', coalesce((p_header ->> 'reverse_charge')::boolean, false),
      p_header ->> 'delivery_address'
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
      delivery_address = p_header ->> 'delivery_address'
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

revoke execute on function public.save_invoice(uuid, uuid, timestamptz, jsonb, jsonb) from public, anon;
grant execute on function public.save_invoice(uuid, uuid, timestamptz, jsonb, jsonb) to authenticated;
