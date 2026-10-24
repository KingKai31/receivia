// Installs the pg_cron fallback: every day at 10:00 IST (04:30 UTC) the database calls the agent-run edge
// function for every business, the same job as the Render workflow. Safe to re-run (replaces the job).
// Usage: node scripts/setup-pgcron.mjs          (install)      node scripts/setup-pgcron.mjs --remove
// Needs PROD_DATABASE_URL, VITE_SUPABASE_URL (or SUPABASE_PROJECT_REF) and AGENT_CRON_SECRET in .env.local.
import fs from 'node:fs';
import pg from 'pg';

for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
}
const base = (
  process.env.VITE_SUPABASE_URL ?? `https://${process.env.SUPABASE_PROJECT_REF}.supabase.co`
).replace(/\/$/, '');
const secret = process.env.AGENT_CRON_SECRET;
if (!secret) throw new Error('AGENT_CRON_SECRET is not set');
const c = new pg.Client({
  connectionString: process.env.PROD_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
await c.query('create extension if not exists pg_cron');
await c.query('create extension if not exists pg_net with schema extensions');
await c.query(`select cron.unschedule(jobid) from cron.job where jobname = 'receivia-agent-daily'`);
if (!process.argv.includes('--remove')) {
  const cmd = `select net.http_post(
    url := '${base}/functions/v1/agent-run',
    headers := jsonb_build_object('content-type', 'application/json', 'x-agent-secret', '${secret}'),
    body := '{"step":"all","trigger":"pg_cron"}'::jsonb,
    timeout_milliseconds := 120000)`;
  await c.query(`select cron.schedule('receivia-agent-daily', '30 4 * * *', $1)`, [cmd]);
  const r = await c.query(
    `select jobname, schedule, active from cron.job where jobname = 'receivia-agent-daily'`,
  );
  console.log(r.rows);
} else console.log('removed');
await c.end();
