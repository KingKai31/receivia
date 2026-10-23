-- S3 collections: ladder stage next_steps, acceptance date, editable ladder + letter settings,
-- customer snooze, dispute flag maintenance, atomic send log with a one-message-a-day rule.

alter table public.reminders drop constraint if exists reminders_stage_check;
alter table public.reminders add constraint reminders_stage_check
  check (stage in ('pre_due', 'due_today', 'overdue_gentle', 'overdue_firm', 'final', 'demand_letter', 'next_steps'));

alter table public.invoices
  add column accepted_on date,
  add column approved_stages text[] not null default '{}';

alter table public.business_profile
  add column ladder_config jsonb check (ladder_config is null or jsonb_typeof(ladder_config) = 'object'),
  add column demand_letter_days int not null default 7 check (demand_letter_days between 1 and 60);

alter table public.customers add column snoozed_until date;

-- Messages sent by someone outside the app can be logged against a channel only once per day.
create index messages_org_customer_sent_idx on public.messages (org_id, customer_id, sent_at desc)
  where direction = 'outbound';
create index disputes_org_open_idx on public.disputes (org_id, invoice_id) where status = 'open';
create index promises_org_open_idx on public.promises (org_id, invoice_id) where status = 'open';

-- invoices.disputed follows open disputes.
create function app.sync_disputed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_invoice uuid;
  v_org uuid;
begin
  for v_invoice, v_org in
    select x.invoice_id, x.org_id from (
      select new.invoice_id, new.org_id where tg_op in ('INSERT', 'UPDATE')
      union
      select old.invoice_id, old.org_id where tg_op in ('DELETE', 'UPDATE')
    ) x
  loop
    update public.invoices i set disputed = exists (
      select 1 from public.disputes d
      where d.invoice_id = v_invoice and d.org_id = v_org and d.status = 'open'
    ) where i.id = v_invoice and i.org_id = v_org
      and i.disputed is distinct from exists (
        select 1 from public.disputes d
        where d.invoice_id = v_invoice and d.org_id = v_org and d.status = 'open');
  end loop;
  return null;
end $$;

create trigger disputes_sync after insert or update or delete on public.disputes
  for each row execute function app.sync_disputed();

-- Logs that a reminder went out (or was marked as sent): reminder + message in one transaction.
-- Idempotent per (invoice, stage, channel). One outbound message per customer per IST day.
create function public.record_send(
  p_org uuid, p_invoice uuid, p_stage text, p_channel text, p_body text
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_customer uuid;
  v_reminder uuid;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select i.customer_id into v_customer from public.invoices i where i.id = p_invoice and i.org_id = p_org;
  if v_customer is null then
    raise exception 'invoice not found' using errcode = 'P0002';
  end if;
  select r.id into v_reminder from public.reminders r
    where r.org_id = p_org and r.invoice_id = p_invoice and r.stage = p_stage and r.channel = p_channel;
  if v_reminder is not null then
    return v_reminder;
  end if;
  if exists (
    select 1 from public.messages m
    where m.org_id = p_org and m.customer_id = v_customer and m.direction = 'outbound'
      and (m.sent_at at time zone 'Asia/Kolkata')::date = v_today
  ) then
    raise exception 'daily message limit reached for this customer' using errcode = '23514';
  end if;
  insert into public.reminders (org_id, invoice_id, customer_id, stage, channel, status, scheduled_for, sent_at)
    values (p_org, p_invoice, v_customer, p_stage, p_channel, 'sent', now(), now())
    returning id into v_reminder;
  insert into public.messages (org_id, customer_id, invoice_id, reminder_id, channel, direction, status, body, sent_at)
    values (p_org, v_customer, p_invoice, v_reminder, p_channel, 'outbound', 'sent', p_body, now());
  return v_reminder;
end $$;

revoke execute on function public.record_send(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.record_send(uuid, uuid, text, text, text) to authenticated;
