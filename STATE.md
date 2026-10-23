# STATE

## Status
- [ ] S1 Foundation
  - [x] 1 Scaffold
  - [x] 2 lib/money
  - [x] 3 lib/gst
  - [x] 4 lib/gstin
  - [x] 5 lib/dates
  - [ ] 6 Migration 0001
  - [ ] 7 Auth + demo function
  - [ ] 8 App shell + ui
  - [ ] 9 render.yaml + CI
  - [ ] 10 Isolation tests
- S2 Invoicing and import: not started
- S3 Collections and documents: not started
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
| SUPABASE_SERVICE_ROLE_KEY | edge functions / tests | local .env / Supabase secrets | missing |
| DEMO_EMAIL, DEMO_PASSWORD | shared demo user | local .env / Supabase secrets | missing |
| ANTHROPIC_API_KEY | agent (edge only) | Supabase secrets | missing |
| RAZORPAY_KEY_ID / _KEY_SECRET / _WEBHOOK_SECRET | payments test mode | Supabase secrets | missing |
| RESEND_API_KEY | email | Supabase secrets | missing |
| WHATSAPP_TOKEN, WHATSAPP_PHONE_ID | WhatsApp | Supabase secrets | missing |
| N8N_WEBHOOK_URL, N8N_SHARED_SECRET | n8n | Supabase secrets | missing |
| APP_BASE_URL | links in messages | Supabase secrets / Render | missing |

## Services
- Supabase: ref none, region ap-south-1 required — not created
- Render: none — not created
- Razorpay: test mode — no account linked
- n8n, Resend, WhatsApp, Anthropic: not set up

## Database
(filled by task 6)

## Edge functions and APIs
(filled by task 7)

## Frontend routes
(filled by task 8)

## Data
- Demo org fixed id, demo login via edge function `demo-login`. Demo date: not set.

## Where to find things
(filled as built)

## Tests
(filled as built)

## Decisions
- 2026-10-23: Supabase CLI as npm devDependency (no global install needed).

## Needs owner
(filled as discovered)

## Session log
(none yet)

## Next session
Continue S1 from first unticked task.
