-- S6: agent planner, autonomy settings, run log.

alter table public.business_profile
  add column autonomy_level int not null default 0 check (autonomy_level between 0 and 2),
  add column channels text[] not null default array['email', 'whatsapp']
    check (channels <@ array['email', 'whatsapp']),
  add column quiet_start_hour int not null default 21 check (quiet_start_hour between 0 and 23),
  add column quiet_end_hour int not null default 9 check (quiet_end_hour between 0 and 23),
  add column test_mode boolean not null default true,
  add column demo_date date,
  add column owner_email text check (owner_email is null or owner_email ~ '^[^@\s]+@[^@\s]+$'),
  add column owner_language text not null default 'en' check (owner_language in ('en', 'hi', 'mr'));

-- Existing check on agent_actions.status allowed proposed/approved/executed/rejected/failed.
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.agent_actions'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) like '%executed%';
  if c is not null then execute format('alter table public.agent_actions drop constraint %I', c); end if;
end $$;
update public.agent_actions set status = 'sent' where status = 'executed';

alter table public.agent_actions
  add constraint agent_actions_status_check
    check (status in ('proposed', 'approved', 'sent', 'failed', 'skipped', 'rejected')),
  add column run_date date not null default current_date,
  add column stage text,
  add column channel text check (channel in ('email', 'whatsapp')),
  add column priority int not null default 0,
  add column subject text,
  add column body_template text,
  add column draft_source text check (draft_source in ('ai', 'template')),
  add column draft_note text,
  add column approver text,
  add column decision_log jsonb not null default '[]'::jsonb,
  add column attempts int not null default 0,
  add column error text,
  add column wa_url text;

-- One action per invoice, stage and plan day: re-running the planner is idempotent.
create unique index agent_actions_plan_uq
  on public.agent_actions (org_id, invoice_id, action_type, stage, run_date)
  where invoice_id is not null;
create index agent_actions_org_day_idx on public.agent_actions (org_id, run_date, status);

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  run_date date not null,
  trigger text not null default 'manual' check (trigger in ('manual', 'render', 'pg_cron', 'local', 'approve_link')),
  status text not null default 'running' check (status in ('running', 'ok', 'partial', 'failed')),
  steps jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index agent_runs_org_idx on public.agent_runs (org_id, started_at desc);

create trigger agent_runs_before_update before update on public.agent_runs
  for each row execute function app.before_update();
create trigger agent_runs_audit after insert or update or delete on public.agent_runs
  for each row execute function app.audit_row();
alter table public.agent_runs enable row level security;
create policy agent_runs_select on public.agent_runs for select to authenticated
  using (app.is_member(org_id));
grant select on public.agent_runs to authenticated;

grant execute on function public.record_send(uuid, uuid, text, text, text) to service_role;
