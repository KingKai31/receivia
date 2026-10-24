-- S7: contact consent records, client error log, organisation erasure (DPDP), audit scrub on erasure.

-- ---------------------------------------------------------------------------
-- Consent to be contacted (one row per decision; the latest row per customer and channel counts)
-- ---------------------------------------------------------------------------
create table public.customer_consents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  customer_id uuid not null,
  channel text not null check (channel in ('email', 'whatsapp', 'sms', 'any')),
  status text not null check (status in ('granted', 'withdrawn')),
  basis text not null check (basis in ('written', 'verbal', 'pay_page', 'existing_relationship', 'other')),
  note text check (note is null or char_length(note) <= 500),
  recorded_by uuid references auth.users (id) on delete set null default auth.uid(),
  recorded_on date not null default ((now() at time zone 'Asia/Kolkata')::date),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (customer_id, org_id) references public.customers (id, org_id) on delete cascade
);
create index customer_consents_lookup_idx
  on public.customer_consents (org_id, customer_id, channel, created_at desc);

-- ---------------------------------------------------------------------------
-- Errors seen in the browser (what the person saw, not their data)
-- ---------------------------------------------------------------------------
create table public.app_errors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null default auth.uid(),
  route text not null check (char_length(route) <= 300),
  message text not null check (char_length(message) <= 1000),
  stack text check (stack is null or char_length(stack) <= 4000),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index app_errors_org_time_idx on public.app_errors (org_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['customer_consents', 'app_errors'] loop
    execute format('create trigger %I before update on public.%I for each row execute function app.before_update()', t || '_before_update', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
  execute 'create trigger customer_consents_audit after insert or update or delete on public.customer_consents for each row execute function app.audit_row()';

  execute 'create policy customer_consents_select on public.customer_consents for select to authenticated using (app.is_member(org_id))';
  execute 'create policy customer_consents_insert on public.customer_consents for insert to authenticated with check (app.can_write(org_id))';
  execute 'create policy customer_consents_update on public.customer_consents for update to authenticated using (app.can_write(org_id)) with check (app.can_write(org_id))';
  execute 'create policy customer_consents_delete on public.customer_consents for delete to authenticated using (app.can_write(org_id))';

  -- Any member (including a read-only CA) may report an error from their own session; owner and accountant read.
  execute 'create policy app_errors_insert on public.app_errors for insert to authenticated with check (app.is_member(org_id) and user_id = auth.uid())';
  execute 'create policy app_errors_select on public.app_errors for select to authenticated using (app.can_write(org_id))';
end $$;

-- ---------------------------------------------------------------------------
-- Erasure: the audit trail may be scrubbed (data removed, record kept) only while erasing an
-- organisation that no longer exists. Nothing else can update or delete an audit row.
-- ---------------------------------------------------------------------------
create or replace function app.audit_block() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE'
     and current_setting('app.erase_audit', true) = old.org_id::text
     and not exists (select 1 from public.orgs o where o.id = old.org_id)
     and new.old_data is null and new.new_data is null and new.actor_id is null
     and new.org_id = old.org_id and new.action = old.action and new.table_name = old.table_name
     and new.record_id is not distinct from old.record_id then
    return new;
  end if;
  raise exception 'audit_log is append-only' using errcode = '42501';
end $$;

alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in ('INSERT', 'UPDATE', 'DELETE', 'ORG_ERASED'));

-- Deletes an organisation and everything in it. Owner only, typed name must match, never the demo org.
create function public.delete_org(p_org uuid, p_confirm text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
begin
  if p_org = '00000000-0000-4000-8000-00000000de60'::uuid then
    raise exception 'the demo organisation cannot be deleted' using errcode = '42501';
  end if;
  if not app.is_owner(p_org) then
    raise exception 'only the owner can delete the organisation' using errcode = '42501';
  end if;
  select name into v_name from public.orgs where id = p_org;
  if v_name is null then
    raise exception 'organisation not found' using errcode = 'P0002';
  end if;
  if p_confirm is distinct from v_name then
    raise exception 'the typed name does not match' using errcode = '22023';
  end if;

  perform set_config('app.erase_audit', p_org::text, true);
  delete from public.orgs where id = p_org;
  -- Deleting fired the audit trigger once per row; remove the personal data from those entries too.
  update public.audit_log set old_data = null, new_data = null, actor_id = null where org_id = p_org;
  insert into public.audit_log (org_id, actor_id, action, table_name, record_id)
    values (p_org, (select auth.uid()), 'ORG_ERASED', 'orgs', p_org);
end $$;
revoke execute on function public.delete_org(uuid, text) from public, anon;
grant execute on function public.delete_org(uuid, text) to authenticated;
