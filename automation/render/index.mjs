// Render Workflow: the daily collections agent. Registered tasks (the start command imports this file):
//   daily        orchestrates every business: runOrg per org, then a run log per org
//   runOrg       plan -> send -> brief for one org, each as its own task with its own retries
//   plan / send / brief / log   thin calls to the agent-run edge function (all logic lives there)
// Triggered at 10:00 IST by the cron job in render.yaml (trigger.mjs), or on demand:
//   render workflows tasks start receivia-agent/daily   (or Dashboard > Workflow > Tasks > Start Task)
import { task } from '@renderinc/sdk/workflows';

const base = () => {
  const url = process.env.SUPABASE_FUNCTIONS_URL;
  const secret = process.env.AGENT_CRON_SECRET;
  if (!url || !secret) throw new Error('SUPABASE_FUNCTIONS_URL and AGENT_CRON_SECRET must be set');
  return { url: url.replace(/\/$/, ''), secret };
};

async function agent(body) {
  const { url, secret } = base();
  const res = await fetch(`${url}/agent-run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-agent-secret': secret },
    body: JSON.stringify({ trigger: 'render', ...body }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(`agent-run ${body.step} ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

const retry = { maxRetries: 3, waitDurationMs: 2000, backoffScaling: 2 };

const plan = task({ name: 'plan', retry, timeoutSeconds: 300 }, async function plan(ctx, orgId) {
  return agent({ org_id: orgId, step: 'plan' });
});
const send = task({ name: 'send', retry, timeoutSeconds: 300 }, async function send(ctx, orgId) {
  return agent({ org_id: orgId, step: 'send' });
});
const brief = task({ name: 'brief', retry, timeoutSeconds: 120 }, async function brief(ctx, orgId) {
  return agent({ org_id: orgId, step: 'brief' });
});
const log = task(
  { name: 'log', retry, timeoutSeconds: 60 },
  async function log(ctx, orgId, status, steps) {
    return agent({ org_id: orgId, step: 'log', status, steps });
  },
);

const runOrg = task({ name: 'runOrg', timeoutSeconds: 900 }, async function runOrg(ctx, orgId) {
  const steps = [];
  for (const [name, fn] of [
    ['plan', plan],
    ['send', send],
    ['brief', brief],
  ]) {
    try {
      steps.push({ step: name, ok: true, attempts: 1, result: await ctx.run(fn, orgId) });
    } catch (e) {
      // The task already used its retries. Record the failure and carry on with the next step.
      steps.push({
        step: name,
        ok: false,
        attempts: retry.maxRetries + 1,
        error: String(e.message ?? e).slice(0, 300),
      });
    }
  }
  const bad = steps.filter((s) => !s.ok).length;
  const status = bad === 0 ? 'ok' : bad === steps.length ? 'failed' : 'partial';
  await ctx.run(log, orgId, status, steps);
  return { orgId, status };
});

task({ name: 'daily', timeoutSeconds: 3600 }, async function daily(ctx) {
  const { orgs } = await agent({ step: 'orgs' });
  const results = [];
  for (const orgId of orgs) {
    try {
      results.push(await ctx.run(runOrg, orgId));
    } catch (e) {
      results.push({ orgId, status: 'failed', error: String(e.message ?? e).slice(0, 300) });
    }
  }
  return { orgs: orgs.length, results };
});
