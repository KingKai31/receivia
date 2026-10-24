// Local runner for the daily agent job: calls the agent-run edge function for every org (or one).
// Usage: node scripts/agent-run.mjs [--org <uuid>] [--step all|plan|send|brief] [--no-brief]
// Reads SUPABASE_PROJECT_REF / VITE_SUPABASE_URL and AGENT_CRON_SECRET from .env.local or the environment.
import fs from 'node:fs';

if (fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
  }
}
const args = process.argv.slice(2);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const base = (
  process.env.VITE_SUPABASE_URL ?? `https://${process.env.SUPABASE_PROJECT_REF}.supabase.co`
).replace(/\/$/, '');
const secret = process.env.AGENT_CRON_SECRET;
if (!secret) throw new Error('AGENT_CRON_SECRET is not set');

async function call(body) {
  const r = await fetch(`${base}/functions/v1/agent-run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-agent-secret': secret },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`agent-run ${r.status}: ${JSON.stringify(j)}`);
  return j;
}

const step = opt('--step') ?? 'all';
const orgs = opt('--org') ? [opt('--org')] : (await call({ step: 'orgs' })).orgs;
for (const org of orgs) {
  const res = await call({
    org_id: org,
    step,
    trigger: 'local',
    skip_brief: args.includes('--no-brief'),
  });
  console.log(org, JSON.stringify(res));
}
