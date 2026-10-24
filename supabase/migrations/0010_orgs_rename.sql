-- A stored generated column (orgs.org_id) is not yet filled in when a BEFORE UPDATE trigger runs, so the
-- immutability check made renaming an organisation fail. orgs.org_id is generated from id and cannot change.
create or replace function app.before_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_table_name <> 'orgs' and new.org_id is distinct from old.org_id then
    raise exception 'org_id is immutable' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
