# Receivia

## Rules for every session
- Read CLAUDE.md and STATE.md first. Read other files only right before editing them. No repo-wide scans; never read node_modules, lockfiles or build output.
- Minimal tokens: no restating plans, no long explanations, no unrequested refactors. Reports max 10 lines.
- Work the session's task list in order. After each task: run its tests, commit (conventional message describing what was built, no attribution), tick it in STATE.md.
- DECISION GATE (first message, before any work, unless the prompt says decisions are already made): list decisions not settled by CLAUDE.md/STATE.md (UI/UX, visual design, layout, copy/tone, naming, vendors, data-model trade-offs, anything user-facing or hard to change later), each with a one-line default. Ask once: "Decide these yourself, or should I answer each?" Wait. Internal choices: decide and log in STATE.md > Decisions.
- Mid-session user-facing decision: if owner said "decide yourself", pick the most conservative option and log it; otherwise stop and ask, batching questions.
- NEVER make visual design decisions alone. Until the design session the UI is a plain functional shell: semantic HTML, Tailwind for layout/spacing only, system font, neutral greys from src/styles/tokens.css, shared UI in src/components/ui.
- Anything needing the owner (keys, accounts) goes to STATE.md > Needs owner; continue with a stub.
- Never weaken a test to pass. Only touch files in the session's scope.
- Production standard: multi-business safe (RLS, no cross-org access), paginated lists, indexed queries, idempotent writes, typed errors, tests for every rule.
- If interrupted, the next session continues from the first unticked task in STATE.md without asking.
- Last step of every session: update STATE.md (changed sections, Session log entry, Next session), commit, print: done, blockers, next.

## Product
Collections and cash-flow layer on top of Tally/Vyapar. Pillars: import + GST invoicing; Buyer Compliance Lens; governed collections agent; buyer pay portal; reconciliation + TDS; probabilistic forecast + gap solver; owner brief on WhatsApp; trust layer.

## Stack
React 18 + Vite + TypeScript strict + Tailwind + React Router + TanStack Query + zod + react-hook-form + i18next (en/hi/mr). Supabase (Postgres, Auth, RLS, Edge Functions, region ap-south-1). Vitest + fast-check + Playwright. Render static site + Render Workflows. n8n. Razorpay test mode. Anthropic API (claude-sonnet-5-5) only from edge functions.

## Folders
src/app, src/features/<feature>, src/components/ui, src/styles, src/lib/{money,gst,gstin,dates,words,legal,forecast,match}, supabase/{migrations,functions,seed}, automation/{n8n,render}, tests/e2e, docs.

## Money and GST rules
- Integer paise everywhere; convert typed rupees once; Intl en-IN; amount in words with lakh/crore; IST dates; FY April–March.
- Per-line taxable = qty × rate − discount; tax per line rounded to paisa. Same state: CGST and SGST each half rate, rounded separately. Other state: IGST. State = first 2 GSTIN digits. Rates in config (0, 0.25, 3, 5, 18, 40; "verify on cbic-gst.gov.in"). Round-off line to nearest rupee.
- Regular = Tax Invoice; composition = Bill of Supply headed "Composition taxable person, not eligible to collect tax on supplies"; unregistered = plain invoice. e-invoice note when turnover > ₹5 crore.

## Legal wording rules
- "Payment Demand Letter" only; never "legal notice"; near the top: "This letter is from <business> about money owed for the invoices listed below. It is not a notice from the GST department and not a legal notice from a lawyer." No emblems, seals, threats.
- Buyer-side lines are hedged ("may", "generally"), name the section, end with "General information, not legal or tax advice."

## Security rules
RLS on every table; secrets only in env; no keys in frontend; pay-link tokens stored as sha256 with expiry; audit_log append-only (DB trigger).

## Conventions (S1)
- Git: main + feat/<name>; conventional commits; no attribution lines.
- Roles: owner full; accountant read/write all except orgs, memberships, business_profile; CA read-only. audit_log written only by DB triggers / security-definer functions, never client insert; append-only.
- Money: branded `Paise` (safe integer). formatINR = ₹ en-IN 2 decimals (documents); formatINRShort = no decimals when whole (UI tiles).
- Invoice number `INV/26-27/0001` (prefix from business_profile.invoice_prefix, default INV, ≤16 chars total).
- UUID primary keys. English copy only; hi/mr keys fall back to English.

## Commands
- dev: `npm run dev`
- test (unit): `npm test`
- isolation tests (needs Docker + local Supabase): `npm run test:db`
- e2e: `npm run e2e` (Playwright, not yet populated)
- lint: `npm run lint`; typecheck: `npm run typecheck`
- db start: `npm run db:start`; db reset (apply migrations + seed): `npm run db:reset`; stop: `npm run db:stop`
- seed: `npm run db:reset` (supabase/seed/seed.sql runs on reset)
- deploy: Render static site from render.yaml; edge functions `npx supabase functions deploy <name>`; migrations `npx supabase db push`
