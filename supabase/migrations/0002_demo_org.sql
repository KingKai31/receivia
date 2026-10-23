-- Fixed-id shared demo org. The demo-login edge function adds the demo user as an accountant
-- (read/write data, no changes to org, memberships or business profile).
insert into public.orgs (id, name) values ('00000000-0000-4000-8000-00000000de60', 'Demo Traders')
on conflict (id) do nothing;

insert into public.business_profile (org_id, legal_name, state_code, registration_type, invoice_prefix)
values ('00000000-0000-4000-8000-00000000de60', 'Demo Traders', '27', 'regular', 'INV')
on conflict (org_id) do nothing;
