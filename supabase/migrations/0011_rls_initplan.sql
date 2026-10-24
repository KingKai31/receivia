-- Scale: the row-level security policies called app.is_member(org_id) / can_write / is_owner once per row,
-- each call being a lookup in memberships. 5,000 invoices took ~450 ms to count. These helpers return the
-- caller's organisations once per query (a hashed sub-plan), so cost no longer grows with rows scanned.
create function app.org_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.org_id from public.memberships m where m.user_id = (select auth.uid())
$$;
create function app.writer_org_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.org_id from public.memberships m
   where m.user_id = (select auth.uid()) and m.role in ('owner', 'accountant')
$$;
create function app.owner_org_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.org_id from public.memberships m where m.user_id = (select auth.uid()) and m.role = 'owner'
$$;
revoke execute on function app.org_ids(), app.writer_org_ids(), app.owner_org_ids() from public, anon;
grant execute on function app.org_ids(), app.writer_org_ids(), app.owner_org_ids() to authenticated;

do $$
declare
  r record;
  q text;
  w text;
  pat text := 'app\.(is_member|can_write|is_owner)\(([a-z_]+)\)';
  stmt text;
  rewrite text;
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check from pg_policies
     where schemaname = 'public' and (coalesce(qual, '') ~ pat or coalesce(with_check, '') ~ pat)
  loop
    q := r.qual;
    w := r.with_check;
    foreach rewrite in array array['is_member:org_ids', 'can_write:writer_org_ids', 'is_owner:owner_org_ids'] loop
      q := regexp_replace(q, 'app\.' || split_part(rewrite, ':', 1) || '\(([a-z_]+)\)', '\1 in (select app.' || split_part(rewrite, ':', 2) || '())', 'g');
      w := regexp_replace(w, 'app\.' || split_part(rewrite, ':', 1) || '\(([a-z_]+)\)', '\1 in (select app.' || split_part(rewrite, ':', 2) || '())', 'g');
    end loop;
    stmt := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if q is not null then stmt := stmt || ' using (' || q || ')'; end if;
    if w is not null then stmt := stmt || ' with check (' || w || ')'; end if;
    execute stmt;
  end loop;
end $$;

-- Search boxes use ILIKE '%text%'; trigram indexes keep them fast as lists grow.
create extension if not exists pg_trgm with schema extensions;
create index if not exists invoices_number_trgm_idx on public.invoices using gin (number extensions.gin_trgm_ops);
create index if not exists customers_name_trgm_idx on public.customers using gin (name extensions.gin_trgm_ops);
create index if not exists invoices_org_issue_created_idx on public.invoices (org_id, issue_date desc, created_at desc);
