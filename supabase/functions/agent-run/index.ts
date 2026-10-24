// Runs the collections agent. Callers: Render workflow / pg_cron / local runner (x-agent-secret) or an
// owner/accountant signed in (their own org only).
// Body: {org_id?, step: 'orgs'|'plan'|'send'|'brief'|'all', trigger?, skip_brief?, action_ids?}
import { cors, json } from '../_shared/http.ts';
import { agentEnv, authorize, serviceClient } from '../_shared/agent-auth.ts';
import { listOrgs, runAll, runBrief, runPlan, runSend } from '../_shared/agent.bundle.js';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const orgId = typeof b.org_id === 'string' ? b.org_id : null;
  const step = typeof b.step === 'string' ? b.step : 'all';
  const who = await authorize(req, orgId);
  if (!who) return json({ error: 'unauthorized' }, 401);
  const db = serviceClient();
  const env = agentEnv();
  if (!env.signingSecret) return json({ error: 'not_configured' }, 503);
  try {
    if (step === 'orgs') {
      if (who.kind !== 'server') return json({ error: 'forbidden' }, 403);
      return json({ orgs: await listOrgs(db) });
    }
    if (step === 'all' && !orgId) {
      // Daily job for every business (pg_cron fallback). One failing org does not stop the others.
      if (who.kind !== 'server') return json({ error: 'forbidden' }, 403);
      const out: Record<string, unknown> = {};
      for (const id of await listOrgs(db)) {
        try {
          out[id] = await runAll(db, id, env, (b.trigger as string) ?? 'pg_cron');
        } catch (e) {
          out[id] = { error: (e as Error).message.slice(0, 200) };
        }
      }
      return json({ orgs: out });
    }
    if (!orgId) return json({ error: 'org_id required' }, 400);
    if (step === 'log') {
      // Run log written by the Render workflow, which runs the steps itself.
      if (who.kind !== 'server') return json({ error: 'forbidden' }, 403);
      const ins = await db.from('agent_runs').insert({
        org_id: orgId,
        run_date:
          typeof b.run_date === 'string' ? b.run_date : new Date().toISOString().slice(0, 10),
        trigger: 'render',
        status: ['ok', 'partial', 'failed'].includes(String(b.status)) ? b.status : 'failed',
        steps: Array.isArray(b.steps) ? b.steps : [],
        finished_at: new Date().toISOString(),
      });
      return ins.error
        ? json({ error: 'failed', message: ins.error.message }, 500)
        : json({ ok: true });
    }
    const trigger = who.kind === 'server' ? ((b.trigger as string) ?? 'local') : 'manual';
    if (step === 'plan') return json(await runPlan(db, orgId, env));
    if (step === 'send') {
      const ids = Array.isArray(b.action_ids) ? (b.action_ids as string[]) : undefined;
      return json(await runSend(db, orgId, env, { actionIds: ids }));
    }
    if (step === 'brief') return json(await runBrief(db, orgId, env));
    if (step === 'all')
      return json(await runAll(db, orgId, env, trigger, { skipBrief: b.skip_brief === true }));
    return json({ error: 'bad_step' }, 400);
  } catch (e) {
    return json({ error: 'failed', message: (e as Error).message.slice(0, 300) }, 500);
  }
});
