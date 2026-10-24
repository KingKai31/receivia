# STATE

## Status
- [x] S1 Foundation (all tasks done; isolation tests still to be re-run on real local Supabase, see Needs owner)
  - [x] 1 Scaffold
  - [x] 2 lib/money
  - [x] 3 lib/gst
  - [x] 4 lib/gstin
  - [x] 5 lib/dates
  - [x] 6 Migration 0001 (+0002 demo org)
  - [x] 7 Auth + demo function
  - [x] 8 App shell + ui
  - [x] 9 render.yaml + CI
  - [x] 10 Isolation tests (135 pass on PGlite emulation; pending run on real Supabase/Docker)
- [x] S2 Invoicing and import (all 9 tasks done; real Supabase run pending, see Needs owner 1)
  - [x] 1 Business profile form  - [x] 2 Customers  - [x] 3 New invoice  - [x] 4 Print page /doc/invoice/:id
  - [x] 5 Credit/debit notes  - [x] 6 Import (CSV, Excel, Tally XML)  - [x] 7 Invoices list + detail timeline
  - [x] 8 Typed service layer + optimistic concurrency  - [x] 9 Tests
- [x] S3 Collections and documents (code tasks 1-7 and Step 0 done; authenticated screens not smoke-tested, see Needs owner 0)
  - [x] 0 Remote DB check / migrate / public-screen smoke  - [x] 1 lib/legal  - [x] 2 Ladder  - [x] 3 Templates + send rules
  - [x] 4 Collect > Today  - [x] 5 /doc/letter/:id  - [x] 6 /doc/case/:customerId  - [x] 7 Tests
- S4 Buyer portal payments reconciliation: not started
- S5 Forecast and prioritisation: not started
- S6 Agent and automation: not started
- S7 Quality and trust: not started
- S9 Design pass: not started
- S8 Ship: not started

## Environment
| Var | Purpose | Where set | Status |
|---|---|---|---|
| VITE_SUPABASE_URL | Supabase API URL | local .env / Render | missing |
| VITE_SUPABASE_ANON_KEY | public anon key | local .env / Render | missing |
| SUPABASE_SERVICE_ROLE_KEY | edge functions / tests | local .env / Supabase secrets (auto in edge runtime) | missing |
| DEMO_EMAIL, DEMO_PASSWORD | shared demo user (used by demo-login) | local .env / Supabase secrets | missing |
| ANTHROPIC_API_KEY | agent (edge only) | Supabase secrets | missing |
| RAZORPAY_KEY_ID / _KEY_SECRET / _WEBHOOK_SECRET | payments test mode | Supabase secrets | missing |
| RESEND_API_KEY | email | Supabase secrets | missing |
| WHATSAPP_TOKEN, WHATSAPP_PHONE_ID | WhatsApp | Supabase secrets | missing |
| N8N_WEBHOOK_URL, N8N_SHARED_SECRET | n8n | Supabase secrets | missing |
| APP_BASE_URL | links in messages | Supabase secrets / Render | missing |
| TEST_DATABASE_URL, PROD_DATABASE_URL, ALLOW_SINGLE_DB | same Supabase session-pooler URL (single project); ALLOW_SINGLE_DB=true lets scripts/db-remote.mjs run with equal URLs | .env.local (git-ignored) | working |
| DATABASE_URL (tests only, optional) | DB tests; defaults to local `postgresql://postgres:postgres@127.0.0.1:54322/postgres` | shell | default |
| REQUIRE_DB (tests only) | `1` makes db tests fail instead of skip when DB is down | CI | set in CI |

## Services
- Supabase: ref nxohumijpbwfxomvkckk, region ap-northeast-1 (Tokyo, accepted). Local: CLI via npm (`supabase` devDependency), project_id `receivia`.
- Render: none — not created (render.yaml ready: static site `receivia`).
- GitHub: no remote yet; CI in .github/workflows/ci.yml.
- Razorpay: test mode — no account linked
- n8n, Resend, WhatsApp, Anthropic: not set up

## Database
Migrations: `0001_foundation.sql`, `0002_demo_org.sql`, `0003_invoicing.sql`, `0004_collections.sql`. Every table has id uuid pk, org_id, created_at, updated_at (audit_log included; orgs.org_id = id generated). RLS enabled on all. Child tables use composite FKs `(parent_id, org_id)` so a row can never reference another org's parent. `org_id` is immutable (trigger).

Standard RLS (member read; owner/accountant write): customers, invoices, invoice_lines, notes, payments, allocations, bank_txns, disputes, promises, reminders, messages, expenses, tds_entries, ims_status, agent_actions.

| Table | Purpose / key columns | RLS |
|---|---|---|
| gst_states | code (2-digit incl. 97, 99), name; no org_id | authenticated read only |
| orgs | name, created_by | member read; owner update; no client insert/delete |
| memberships | org_id, user_id, role owner/accountant/ca | member read; owner write |
| business_profile | one per org: gstin, state_code, registration_type, annual_turnover_paise, udyam_number, enterprise_size, activity, bank_*, upi_id, invoice_prefix (1-4 chars A-Z0-9, default INV) | member read; owner write |
| customers | gstin (checksum-validated), state_code, credit_days, has_written_agreement, tier, language, entity_type, presumptive_tax, contacts jsonb, opt_in_whatsapp | standard |
| invoices | number (≤16, unique per org), fy, status, dates, GST split + total_paise (=sum check), paid_paise (trigger-maintained), source_ref (import idempotency) | standard |
| invoice_lines | per-line qty, rate, discount, gst_rate (0/0.25/3/5/18/40), tax split | standard |
| notes | credit/debit notes against an invoice | standard |
| invoice_counters | (org, fy) → last_seq, only via next_invoice_number | member read; no client writes |
| payments | amount, method, status, idempotency_key + razorpay_payment_id unique per org | standard |
| allocations | payment→invoice amounts; trigger syncs invoices.paid_paise/status, blocks over-allocation | standard |
| bank_txns | statement lines, dedupe_hash unique per org, matched_payment_id | standard |
| disputes, promises | per invoice | standard |
| reminders | stage, channel, status, scheduled_for, sent_at; unique (org, invoice, stage, channel) | standard |
| messages | channel, direction, status, body, provider_message_id | standard |
| expenses | recurring rules (recurrence, next_due) | standard |
| tds_entries | section, rate, amount, certificate_status | standard |
| ims_status | GST IMS action per invoice | standard |
| agent_actions | proposed/approved/executed with reasoning, policy_checks | standard |
| pay_tokens | token_hash (sha256 hex), expires_at, used_at, revoked_at | owner/accountant read; writes only via create_pay_token |
| audit_log | org_id (no FK, outlives org), actor_id, action, table_name, record_id, old/new data (token_hash stripped) | member read; no client insert/update/delete; trigger blocks UPDATE/DELETE/TRUNCATE for everyone |

Functions/triggers: `app.member_role/is_member/can_write/is_owner` (security definer, search_path empty); `app.gstin_valid`; `app.before_update` (updated_at + org_id lock, on all org tables); `app.audit_row` (after I/U/D on all org tables except audit_log); `app.audit_block`; `app.sync_allocation`; `app.handle_new_user` on auth.users (creates org "My business", owner membership, business_profile; skipped when user_metadata.demo = true); `public.next_invoice_number(org, fy)` (row-locked, gap-free, ≤16 chars, needs write role); `public.create_pay_token(invoice, ttl)` (returns plaintext once, stores sha256).

S2 (0003): `invoices.number` and `notes.number` are nullable (drafts unnumbered; check requires a number unless draft/void). New `invoices.reverse_charge`, `delivery_address`, `disputed` (maintained from S3). `invoice_counters.series` (INV/CN/DN), unique (org, fy, series). Functions: `next_note_number(org, fy, type)` (CN/26-27/0001, DN/...); `issue_invoice(id, expected_updated_at)` and `issue_note(id, expected_updated_at)` (security definer, row-locked, assign number + set issued in one transaction, 40001 on stale updated_at); `save_invoice(org, id, expected, header jsonb, lines jsonb)` (security invoker, atomic create/update of a draft with lines, 40001 on stale updated_at, P0002 if not a draft). Imported invoices: source = 'import', status issued, no lines, original number.

S3 (0004): reminders.stage adds `next_steps`; `invoices.accepted_on` (MSME acceptance date, null = invoice date assumed) and `approved_stages text[]` (key-tier owner approvals); `business_profile.ladder_config jsonb` (null = defaults) and `demand_letter_days` (1-60, default 7); `customers.snoozed_until`; trigger `app.sync_disputed` keeps `invoices.disputed` = has open dispute; `public.record_send(org, invoice, stage, channel, body)` (security invoker, idempotent per invoice/stage/channel, inserts reminder + message atomically, rejects a 2nd outbound message per customer per IST day with 23514). Audit rows come from the existing triggers.

Demo org: id `00000000-0000-4000-8000-00000000de60` ("Demo Traders", state 27, regular), created in migration 0002.

## Edge functions and APIs
| Name | Route | Auth | Purpose |
|---|---|---|---|
| demo-login | POST /functions/v1/demo-login | none (verify_jwt=false) | Ensures demo org/user/accountant membership, signs in with DEMO_EMAIL/DEMO_PASSWORD, returns {access_token, refresh_token}. Not yet deployed or run against real Supabase. |

## Frontend routes
| Path | Purpose | Access |
|---|---|---|
| /sign-in | email OTP + Open live demo | public |
| /pay/:token | buyer pay page (stub, S4) | public |
| /trust | trust page (stub, S7) | public |
| / | Today (stub) | auth |
| /invoices, /invoices/new, /invoices/:id, /invoices/:id/edit, /invoices/:id/notes/new | list+filters, form, detail+timeline, draft edit, credit/debit note | auth |
| /customers, /customers/new, /customers/:id, /customers/:id/edit | list, form, detail (total owed, payment record) | auth |
| /import | CSV / Excel / Tally XML import for customers and invoices | auth (owner/accountant) |
| /doc/invoice/:id, /doc/note/:id | print-ready A4 documents (outside the app layout) | auth |
| /collect | Collect > Today: due actions grouped by customer, WhatsApp/Email/SMS/Mark sent/Snooze/Promise | auth |
| /doc/letter/:id (invoice id), /doc/case/:customerId | Payment Demand Letter (customer's overdue invoices), Samadhaan case pack | auth |
| /payments, /forecast | stubs | auth |
| /settings | org name, role, sign out, business profile form (owner edits) | auth |

## Data
- supabase/seed/seed.sql is a no-op placeholder; demo org comes from migration 0002. Demo data (customers, invoices) arrives in S2.
- Demo login: edge function `demo-login`; demo user role is accountant. Demo date: not set (`setDemoDate()` in src/lib/dates).

## Where to find things
| Module | Path |
|---|---|
| Money (Paise, parseRupees, formatINR, formatINRShort, amountInWordsIndian) | src/lib/money/ |
| GST calc, state table, rates config, invoice type/heading | src/lib/gst/ (calc.ts, states.ts, config.ts) |
| GSTIN validate/generate | src/lib/gstin/index.ts |
| Dates (IST today, FY, daysBetween, formatInvoiceNumber) | src/lib/dates/index.ts |
| Permissions mirror of RLS | src/lib/permissions.ts |
| Supabase client / env | src/lib/supabase.ts, src/lib/env.ts |
| Auth (OTP, demo, provider, useOrg) | src/features/auth/ |
| Routes + providers | src/app/App.tsx; layout/nav src/app/Layout.tsx; i18n src/app/i18n.ts, src/locales/*.json |
| Shared UI | src/components/ui/ (tokens: src/styles/tokens.css) |
| Migrations / seed / functions | supabase/migrations, supabase/seed, supabase/functions |
| DB tests | tests/db/ (helpers.ts has per-table insert builders; add new tables to INSERTS and ALL_ORG_TABLES) |
| Typed errors, guarded update, paging, fake client for tests | src/lib/service/ (errors.ts, testing.ts) |
| Legal rules (itc180, MSME eligibility/due/43B(h)/Form I/interest, lens), config | src/lib/legal/ (config.ts holds RBI bank rate) |
| Ladder, templates, send rules, Today builder, service, page, settings | src/features/collect/ (ladder.ts, templates.ts, today.ts, collectService.ts, CollectTodayPage.tsx, LadderSettings.tsx) |
| Letter + case pack models/components, pages | src/features/documents/collectionDocs.tsx, CollectionDocPages.tsx |
| Remote DB runner (reset-test, migrate-prod, status) | scripts/db-remote.mjs |
| Section 34 warning | src/lib/legal/section34.ts |
| Business profile / customers / invoices / notes services | src/features/{settings,customers,invoices,notes}/*Service.ts |
| Invoice maths from form, display status | src/features/invoices/invoiceModel.ts |
| Document model + A4 components, UPI link, MSME rule | src/features/documents/invoiceDocument.tsx, doc.css |
| Import (parse, map, validate, commit, Tally) | src/features/import/ (importCore, tally, importService) |
| PGlite harness (real migrations in-process) | tests/db/pglite.ts, tests/db/invoicing.test.ts |
| CI / deploy | .github/workflows/ci.yml, render.yaml |

## Tests
- Remote (Tokyo, session pooler): `npm run test:db:remote` = 135 isolation tests (~157s) + tests/db/remote-numbering.test.ts (20 real connections via transaction pooler 6543, session pooler caps at 15 clients) all pass. PGlite tests (invoicing, collections) run in-process only. Final state: reset once more, 0 users, only the demo org, migrations 0001-0004 recorded in receivia_meta.migrations.
- S3: `npm test` now 169 unit tests (legal 18+, ladder/templates 16, today 6, letter/case 6). `npm run test:db`: 15 pass on PGlite (incl. tests/db/collections.test.ts: record_send, daily limit, dispute flag); 135 isolation tests still skipped, NOT run on any real Postgres. Fixed a flaky S2 audit test (ordered by random uuid; now by created_at).
- `npm test`: 125 unit/property tests (S1 libs + S2 service layer, document fields for all 3 invoice types, import validation incl. bad GSTIN rows, 40-invoice CSV commit, Tally XML, Section 34, forms) — all pass.
- `npm run test:db`: tests/db/invoicing.test.ts (9, run on PGlite with the real migrations: consecutive numbering under 20 parallel issues, stale-update conflict, per-series note numbers, save_invoice, audit rows) pass. The 135 isolation tests skip without Docker; they were NOT re-run after migration 0003.
- PGlite is single-connection, so the 20-parallel test proves gap-free/no-repeat numbering and the locking SQL, not true multi-connection contention; re-run on real Supabase.
- `npm run lint`, `npm run typecheck`, `npm run build`: pass (bundle ~1.1 MB; xlsx not yet code-split).
- e2e (Playwright): config only, no specs. New screens not exercised in a browser (no Supabase session available).

## Decisions
- 2026-10-23: Supabase CLI as npm devDependency (no global install).
- 2026-10-23: Invoice prefix is 1-4 chars A-Z0-9 so the number stays ≤16 chars even with a 5-digit sequence.
- 2026-10-23: Demo user is an accountant, not owner, so the public demo cannot change org, members or business profile.
- 2026-10-23: audit_log.org_id has no FK so the trail survives org deletion; org deletion is service-role only.
- 2026-10-23: Composite FKs (id, org_id) on all child tables to make cross-org references impossible at the DB level.
- 2026-10-23: Accountant can read but not write orgs, memberships, business_profile (interpretation of "read/write all except").
- 2026-10-23: Composition and unregistered suppliers collect no tax in calcInvoice; place of supply defaults to buyer GSTIN state, then buyer state, then supplier state.
- 2026-10-23: Amount in words with paise: "Rupees X and Y Paise Only".
- 2026-10-23: Tax rounding is half-up on integer paise; CGST/SGST each round separately from half the rate (so they can differ from IGST by 1 paisa).
- 2026-10-23: @hookform/resolvers pinned to v5 (v6 failed to resolve peer deps with zod 4).
- 2026-10-23: DB tests skip when the DB is unreachable unless REQUIRE_DB=1 (CI sets it).
- 2026-10-24 (S2): Drafts are unnumbered; the number is assigned only inside `issue_invoice` (same transaction as status change) so a failed issue never burns a number.
- 2026-10-24 (S2): Draft save is one RPC (`save_invoice`) rather than client-side insert + lines, for atomicity.
- 2026-10-24 (S2): Display status precedence: void, draft, paid, disputed, overdue, part paid, due soon (≤7 days), issued. Overdue beats part paid so unpaid past-due balance is never hidden.
- 2026-10-24 (S2): Credit/debit notes carry taxable + GST rate only (no lines, no round-off); credit note cannot exceed invoice total. They do not yet reduce invoice balance (S4 reconciliation).
- 2026-10-24 (S2): Section 34 deadline shown as 30 Nov after the invoice's FY end (outer bound; annual-return date unknown), hedged wording.
- 2026-10-24 (S2): Imported invoices have no lines, status issued, keep original number (≤16 chars), unknown customers are auto-created, duplicates by number are skipped (idempotent re-import), total may differ from taxable+taxes by ≤ ₹1 (stored as round-off). Payments are not imported.
- 2026-10-24 (S2): Tally: only Sundry Debtors ledgers and Sales vouchers read; other vouchers/ledgers and unknown tags are skipped and listed in the report. Import capped at 5000 rows per file.
- 2026-10-24 (S2): SheetJS from npm (`xlsx` 0.18.5, last npm release) used for CSV/Excel; parse only, no untrusted write. fast-xml-parser for Tally; qrcode for UPI QR; @electric-sql/pglite (dev) for DB tests without Docker.
- 2026-10-24 (S2): New-feature copy is inline English (not yet in i18n keys); extract in the design pass. Customer picker on invoice form lists up to 100 matches of a search box.
- 2026-10-24 (S3): Ladder stage names reuse DB enum (pre_due=-3 friendly, due_today=0, overdue_firm=+7, final=+15 with call prompt, demand_letter=+30, next_steps=+45 added in 0004; overdue_gentle unused). next_steps is owner guidance, not a buyer message.
- 2026-10-24 (S3): Ladder sends only the latest due stage after a pause (catch-up skips earlier stages), never goes back, key tier needs per-stage owner approval (invoices.approved_stages) beyond firm.
- 2026-10-24 (S3): One message per customer per day: the most severe invoice is the primary, others wait for another day. Quiet hours enforced in the UI only; DB enforces the daily limit in record_send. Snooze is per customer.
- 2026-10-24 (S3): {{pay_link}} shows "[pay link]" in the preview; a pay token (create_pay_token) is minted at send time and substituted. Lens line appears only at firm/final/demand_letter stages. hi/mr disclaimers are translated, not the English sentence.
- 2026-10-24 (S3): Lens priority: 43B(h) for eligible MSME sellers, else ITC 180 days when buyer has GSTIN. 43B(h) skipped for individual and government buyers and presumptive=yes; soft wording for unknown. Government buyers are treated as not claiming deductions.
- 2026-10-24 (S3): MSME due date counts from accepted_on, else the invoice date (shown as "assumed"). RBI bank rate in config is 5.75% as a placeholder (check rbi.org.in); interest rounds each month to paise.
- 2026-10-24 (S3): Letter lists all of the customer's overdue unpaid invoices (route id is one invoice). CLAUDE.md requires the sentence "not a legal notice from a lawyer"; the no-"legal notice" test strips that mandated sentence first.
- 2026-10-24 (S3): scripts/db-remote.mjs uses the sslmode in the connection string (no cert verification override); refuses to run if TEST == PROD.
- 2026-10-24 (S3): One Supabase project (ref nxohumijpbwfxomvkckk, region ap-northeast-1 Tokyo, accepted for the hackathon; CLAUDE.md updated from ap-south-1) is both test and live DB. scripts/db-remote.mjs runs with equal URLs only when ALLOW_SINGLE_DB=true is set in .env.local. Plan: split into separate test and prod projects (and consider Mumbai) after the hackathon.
- 2026-10-24 (S2): Business state for unregistered businesses is picked manually (no GSTIN to derive it from); with a GSTIN it is always derived.

## Needs owner
0. (S3) Authenticated screens (all S1-S3 pages behind sign-in) were NOT browser-smoke-tested: email OTP cannot be read here and demo-login is not deployed. Please sign in once and click through /, /invoices, /customers, /import, /collect, /settings, /doc/*, or deploy demo-login (Needs owner 5) so the next session can do it at 360/1280px. Database is migrated (0001-0004) and clean; do not run `reset-test` once real data exists (it drops everything).
1. Docker Desktop (S2: `docker ps` returned no table within 20 s, so real Supabase run pending; skipped per instructions): it is installed but its engine did not start (it was applying an update / may be waiting on a prompt). Open Docker Desktop, accept any prompt, wait until it says running. Then run `npm run db:start`, `npm run db:reset`, `npm run test:db` and confirm the 135 isolation tests pass (and that tests/db/invoicing.test.ts still passes against real Postgres) after migration 0003; tell the next session if any fail.
2. Create the Supabase project in region ap-south-1 (Mumbai). Then: `npx supabase login`, `npx supabase link --project-ref <ref>`, `npx supabase db push`.
3. In Supabase Auth, edit the "Magic link" / "Confirm signup" email template to show the code: include `{{ .Token }}` (6 digits). Set the email OTP length to 6.
4. Put `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in a local `.env` (copy .env.example) and in Render.
5. Set Supabase function secrets: `npx supabase secrets set DEMO_EMAIL=... DEMO_PASSWORD=...` (any address/password you choose for the shared demo user), then `npx supabase functions deploy demo-login`.
6. Create a GitHub repo and push `main` and `feat/foundation`; CI runs on push/PR. Merge feat/foundation into main when happy.
7. Render: New Blueprint from the repo (render.yaml), set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
8. For later sessions (not needed to deploy S1): Anthropic key, Razorpay test keys, Resend key, WhatsApp Cloud API token and phone id, n8n instance and shared secret.

## Session log
- 2026-10-23, S1 Foundation: scaffold, money/gst/gstin/dates libs, migrations 0001-0002, auth + demo-login, plain app shell with shared UI, render.yaml + CI, isolation tests. Commits 1467292..HEAD on feat/foundation.
- 2026-10-24, S2 Invoicing and import: migration 0003, business profile, customers, invoice form/list/detail, A4 print pages, credit/debit notes, CSV/Excel/Tally import, service layer with optimistic concurrency, tests. Branch feat/invoicing (foundation merged into main first).

- 2026-10-24, S3 Collections and documents: feat/invoicing merged into main; branch feat/collections. lib/legal, ladder, templates, Today page, letter, case pack, migration 0004, settings editor, tests. Step 0 done 2026-10-24 on the single Supabase project: all migrations applied, 135 isolation + 20-connection numbering pass on real Postgres, public screens smoke-tested (no console errors), authenticated screens not.

## Next session
Resolve Needs owner 0 (authenticated smoke test at 360/1280px), then S4 Buyer portal, payments, reconciliation. Run DB suites with `npm run test:db` (PGlite + local) and `npm run test:db:remote` (real Postgres; 135 isolation + 20-connection numbering; DESTRUCTIVE only via reset-test, which the tests do not call). Open: demo seed data, payments import, code-split xlsx/qrcode, hi/mr copy review by a native speaker, inline English UI copy to i18n, accepted_on has no form field yet, credit/debit notes do not reduce balances, split test/prod projects after the hackathon.
