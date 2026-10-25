# Demo video script (4:30)

Live site: https://receivia.onrender.com. Use the phone for 1:50 to 2:20 (pay link) and the laptop for the rest. The demo resets every night; if anything looks off, run `node scripts/reset-demo.mjs`.

Criteria tags: **[I]** Innovation, **[T]** Technical Execution, **[D]** Design & UX, **[Im]** Impact, **[P]** Presentation.

| Time | On screen | Voice-over | Tag |
|---|---|---|---|
| 0:00 | Black card, then a Tally-style overdue list | "A small business in Pune ships boxes on 30-day credit. The Recordent SME Receivables Report 2026 says the average SME waits 73 days to be paid." | Im, P |
| 0:10 | Owner at a desk, phone with unpaid reminders | `[QUOTE PLACEHOLDER: one line from a real owner or accountant about chasing buyers]` "On MSME Samadhaan, ₹55,244 crore of delayed-payment claims are filed. Owners are owed money, and they do not know when it will arrive." | Im |
| 0:20 | Logo, sign-in page, press **Open live demo** | "This is Receivia. One button, no sign-up, and you are inside a real business." | D, P |
| 0:30 | Today: money to collect ₹31,50,600, the red card "Cash is tight in week 3" | "Today tells the owner the one thing that matters: cash is safe for two weeks, then ₹1,30,000 short of the safety buffer in week 3." | D, I |
| 0:40 | Tap **See the full plan** | "Product working: a real forecast, not a guess." | P |
| 0:45 | Forecast page: band chart P10/P50/P90, weekly table | "Each customer's own payment habit drives a 2,000-run simulation. The band is the honest range, not one number." | I, T |
| 1:05 | Gap plan: chase Bharat Auto, defer the starch bill | "The gap solver names the steps, what each is expected to bring in, and what it costs. Chasing is free, so it goes first." | I |
| 1:20 | Collect: customers ordered by chase priority, Mithai Sweets first with "38 days overdue ₹1,18,000" | "Mithai Sweets in Ahmedabad: 38 days overdue, IGST invoice, a key customer. The agent never sends to a key customer without approval." | I, D |
| 1:35 | Raj Plastics row, message box in Hindi, press **Approve and send** | "Raj Plastics prefers Hindi, so the reminder is written in Hindi. The model only writes words; amounts and dates come from the database and a validator checks every draft. One tap approves it." | I, T |
| 1:50 | Phone: pay link opens signed out, Hindi page, UPI QR | "The buyer opens a link on a phone. No login, no app. Amount, QR and the buyer's own language." | D, Im |
| 2:05 | Tap "I have already paid", enter a UTR, send | "Buyers often say they have paid. One tap and the claim lands with the owner, and the reminders pause." | D |
| 2:20 | Laptop: Inbox shows the claim, press **Accept: mark paid** | "The Inbox holds claims, disputes and promises. Accepting records the payment against the invoice." | D, T |
| 2:35 | Payments: import bank CSV, suggested matches with reasons | "Now the bank statement. Every line gets a suggested match and a reason: invoice number, customer name, amount. Nothing is applied until the owner confirms." | T |
| 2:55 | City Hospital line: "Short by TDS", press **Confirm** | "City Hospital paid ₹6,400 less. Receivia recognises 2% GST TDS on the taxable value, records the TDS, and settles the invoice." | I, T |
| 3:10 | Forecast again: the band has moved | "The forecast just updated from the matched payments." | P |
| 3:15 | New invoice: payability checklist, then a Why drawer on Forecast | "Before sending, the checklist scores whether the invoice will be paid on time, and every number has a Why button with its formula and the law." | I, T |
| 3:17 | Collect: paste a Hindi reply; Ask your books | "Paste what the buyer wrote and Receivia files it as a promise or a claim. Ask your books answers from read-only tools, never from guesses." | I |
| 3:19 | Pay link: statement, pay in parts; /how-it-works impact card | "The buyer can see a statement and ask to pay in parts. The impact replay shows days to collect before and after, with assumptions." | Im |
| 3:20 | Pay page footer or a reminder showing the lens line | "Reminders carry one hedged line about the buyer's own tax position, for example the 180-day input tax credit rule or Section 43B(h). Each ends with 'General information, not legal or tax advice.'" | I |
| 3:30 | Architecture diagram from the README | "How it is built: React and Vite on Render, Supabase Postgres with row-level security on every table, edge functions for the agent, and a Render Workflow with retries that runs it every morning at ten." | T |
| 3:45 | /trust page, all green | "Every table has isolation tests, the audit log is append-only, pay tokens are stored hashed. The trust page runs the GST, matching and forecast checks live in your browser." | T, P |
| 3:55 | Real vs simulated list | "What is simulated, honestly: Razorpay has no keys yet, WhatsApp goes out as links, and the data is made up." | T, P |
| 4:10 | Today screen, tiles | "The impact: an owner sees the cash gap three weeks early, chases the right buyer first, and spends minutes, not afternoons, on collections." | Im |
| 4:20 | Roadmap line | "Next: live Razorpay and WhatsApp, IMS and Account Aggregator feeds, native Hindi and Marathi review." | Im |
| 4:25 | End card: **receivia.onrender.com**, team names, deck link | "Try it now: receivia dot onrender dot com." | P |

Recording notes: reduce motion is off in the app, so wait for the count-up to settle before talking about a number. Keep the pointer slow. Do not say "legal notice" anywhere; the product says Payment Demand Letter.
