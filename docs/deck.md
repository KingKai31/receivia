# Deck text (HackCache template, 7 slides)

Link to the working deck: https://docs.google.com/presentation/d/1mSE1vTZvlRFA_0F9jqZMY1InD5XvmBRq/edit?usp=sharing

## Slide 1: Title

**Receivia**
Know when the cash will really arrive. Chase the right buyer first.
Collections and cash-flow for small Indian businesses, on top of Tally and Vyapar.
Live: receivia.onrender.com
Team: `TEAM_NAMES_PLACEHOLDER`

## Slide 2: Problem

**Small suppliers wait 73 days to be paid.**
- Average SME settlement time: 73 days (Recordent, SME Receivables Report 2026).
- ₹55,244 crore of delayed-payment claims filed on MSME Samadhaan.
- Owners know who owes them but not when the money lands, so the salary day on the 1st and the GST on the 20th arrive before the cash does.
- Chasing is awkward, so it happens late, or never.

## Slide 3: Solution

**One screen that says: cash is safe for 2 weeks, then ₹1,30,000 short in week 3. Here is how to close it.**
- Probabilistic 13-week forecast from each customer's own payment habit.
- A gap solver that names the steps and their cost.
- A governed agent that drafts the reminder, in the buyer's language, for the owner's approval.
- A phone-first pay page for the buyer: UPI QR, "I have paid", dispute, promise, statement and pay in parts.
- A payability checklist before an invoice is issued, acceptance proof for the 43B(h) clock, and a government-buyer path.
- Explain-everything: a Why drawer on each figure and /how-it-works; AI reply understanding and Ask your books with checked figures; an impact replay of the last 6 months.
Screenshot: `docs/screens/today-1280-light.png`

## Slide 4: How it works

Three screenshots, left to right:
1. **Forecast** (`docs/screens/forecast-1280-light.png`): P10/P50/P90 band and the week-3 gap plan.
2. **Collect and Inbox** (`docs/screens/collect-1280-light.png`): customers in chase order; Hindi reminder for approval.
3. **Buyer pay page** (`docs/screens/pay-360-light.png`): signed-out, phone-first, Hindi.
Caption: import invoices, see the gap, approve the reminder, buyer pays or claims, the bank line is matched with TDS, the forecast updates.

## Slide 5: How it is built, and what is real

**Built:** React + Vite on Render; Supabase Postgres with row-level security on every table, Auth and Edge Functions; Render Workflow (retries, run log) started by a 10:00 IST cron, with pg_cron as fallback; Resend; Razorpay (test); Anthropic for wording only.
**Engineered:** integer-paise GST maths; Monte Carlo forecast with backtest (WAPE); solver tested against brute force; reminder validator (no digits, links or unknown slots from the model); append-only audit log; hashed expiring pay tokens; isolation tests on every table.
**Real:** invoicing, GST, import, ladder, forecast, solver, matching, TDS, portal, Inbox, email, RLS, Render automation.
**Simulated:** Razorpay (no keys, mock-signed webhook), WhatsApp as links, IMS and Account Aggregator not connected, sample data.

## Slide 6: Impact and next

**Impact:** see the cash gap three weeks early; chase in the order that closes it; collections in minutes a day; buyers get a clear, respectful, bilingual page, and a hedged line on why paying on time helps them too (CGST s16(2), IT Act s43B(h), MSMED ss15-16).
**Next three things:**
1. Live Razorpay and WhatsApp Cloud API with a verified sending domain.
2. GST IMS and Account Aggregator feeds in place of CSV import.
3. Native review of Hindi and Marathi legal lines; pilot with five Pune MSMEs and their CA.

## Slide 7: Team and links

Team: `TEAM_NAMES_PLACEHOLDER`
Live demo: https://receivia.onrender.com
Code: https://github.com/KingKai31/receivia
Video: `VIDEO_LINK_PLACEHOLDER`
Trust page: https://receivia.onrender.com/trust

## Competitor slide (add after slide 3 or as an appendix)

Based on the products' public descriptions; check each before presenting.

| | Vyapar | Khatabook | CredFlow | **Receivia** |
|---|---|---|---|---|
| Invoicing and GST | Yes | Basic billing | Receivables automation | Yes, plus import from Tally and Vyapar |
| Payment reminders | Manual or scheduled | Manual reminders | Automated follow-ups | Ladder with owner approval, Hindi and Marathi |
| Probabilistic cash forecast (P10/P50/P90) | No | No | Not offered | **Yes, with backtest** |
| Gap solver (closes a named shortfall with costed steps) | No | No | No | **Yes** |
| Buyer Compliance Lens (hedged tax and MSME lines for the buyer) | No | No | No | **Yes** |
| TDS-aware bank matching (GST TDS, 194C, 194Q) | No | No | Partial | **Yes** |
| Governed AI agent (validator, owner approval, audit log) | No | No | Automated | **Yes** |
| Buyer pay page with claim, dispute and promise | Payment link | Payment link | Yes | **Yes, signed-out, three languages** |
