# Submission text

## Project description (HackCache form, under 300 words)

Receivia is a collections and cash-flow layer for small Indian businesses, built on top of Tally and Vyapar. Small suppliers wait on average 73 days to be paid (Recordent, SME Receivables Report 2026), and owners rarely know when the money will land, so salary day arrives before the cash does.

Receivia imports invoices, then forecasts the next 13 weeks from each customer's own payment habit using a 2,000-run Monte Carlo simulation (P10/P50/P90, with a backtest). When it finds a shortfall, a gap solver names the steps that close it and what each costs: chase an invoice, offer an early-payment discount, use TReDS, or defer a supplier bill.

A governed collections agent drafts reminders in the buyer's language (English, Hindi or Marathi) for the owner's approval. The model writes words only; every number, date and link comes from the database, and a validator rejects any draft that contains digits or links. Reminders carry one hedged line about the buyer's own position (CGST s16(2) 180-day ITC, Income-tax Act s43B(h), MSMED ss15-16). Demand letters are called Payment Demand Letters, never legal notices.

Before an invoice goes out, a payability checklist scores its chance of being paid on time. Every computed figure has a Why button with the formula, inputs and law, and /how-it-works shows the rules, the live AI accuracy and an impact replay of the last six months. Pasted buyer replies in English, Hindi or Marathi are understood by the model and re-checked by rules, and Ask your books answers from read-only tools with every figure taken from a tool result. Government buyers get a formal, email-only path.

Buyers get a phone-first pay page with UPI QR and one-tap "I have paid", dispute or promise. Bank statements are matched with reasons and TDS-aware (GST TDS 2%, 194C, 194Q); the forecast updates when a match is confirmed.

Engineering: React, Vite and TypeScript on Render; Supabase Postgres with row-level security on every table and isolation tests; append-only audit log; hashed expiring pay tokens; edge functions; a Render Workflow with retries for the daily run. Simulated and said so: Razorpay (test mode, no keys), WhatsApp as links, IMS and Account Aggregator, and the sample data.

New: an AI invoice reader that audits GST with fixed rules before anything is saved, a buyer chat whose every limit is enforced in the database, voice questions in Hindi and Marathi, and a public national-impact estimate with sources and assumptions.

Live: https://receivia.onrender.com (press Open live demo).

## Render track

**Live URL:** https://receivia.onrender.com (static site, Blueprint-managed from `render.yaml`).

**How Render is used**
- **Static site** hosts the React app with an SPA rewrite and security headers; every deploy follows `main`.
- **Render Workflows** (`automation/render`, service `receivia-agent`) run the daily collections agent as tasks: `daily` lists every business, `runOrg` runs `plan`, `send` and `brief` for each as separate tasks with 3 retries and exponential backoff, then `log` writes a run record. A step that still fails is recorded and the next step carries on.
- **Cron job** `receivia-agent-daily` starts the workflow at 10:00 IST (`30 4 * * *`) through the Render API.
- **Cron job** `receivia-demo-reset` (`30 20 * * *`, 02:00 IST) puts the demo organisation back to its story every night, so the live demo always opens on the same shortfall.
- A pg_cron job in Supabase runs the same agent as a fallback; both call one edge function, so the work is identical on every path.

**Status:** the static site is live. The Workflow and the two cron jobs are defined in `render.yaml`; they need `AGENT_CRON_SECRET`, `RENDER_API_KEY` and `TEST_DATABASE_URL` set in the Render dashboard (secrets are not committed), see STATE.md.
