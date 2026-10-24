# n8n connector (optional)

Receivia does not depend on n8n. The daily job runs from a Render Workflow (automation/render) with a
pg_cron fallback in the database (scripts/setup-pgcron.mjs). This workflow is for owners who already run
n8n and prefer to schedule the same job there.

What it does: at 10:00 IST it calls the `agent-run` edge function with `{"step":"all"}`. The function plans
the day, sends approved and auto-allowed reminders, and emails the owner brief (with the signed Approve-all link).

Import: n8n > Workflows > Import from file > `owner-brief.json`. Set two environment variables in n8n:

- `SUPABASE_FUNCTIONS_URL` = `https://<project-ref>.supabase.co/functions/v1`
- `AGENT_CRON_SECRET` = the same value as the Supabase function secret of that name

Do not run this together with the Render job or pg_cron for the same business: the planner is idempotent
and sends at most one message per customer per day, but the brief email would be sent twice.
