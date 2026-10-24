// Approve-all from the owner's daily brief. The link carries an HMAC-signed, expiring token.
// POST {t, confirm?}: confirm=false previews the count; confirm=true approves and sends.
import { cors, json } from '../_shared/http.ts';
import { agentEnv, serviceClient } from '../_shared/agent-auth.ts';
import { approveAll, loadProfile, runSend, verifyApproval } from '../_shared/agent.bundle.js';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const b = (await req.json().catch(() => ({}))) as { t?: string; confirm?: boolean };
  const env = agentEnv();
  if (!env.signingSecret) return json({ error: 'not_configured' }, 503);
  const claims =
    typeof b.t === 'string'
      ? await verifyApproval(b.t, env.signingSecret, Math.floor(Date.now() / 1000))
      : null;
  if (!claims) return json({ error: 'invalid_or_expired' }, 401);
  const db = serviceClient();
  const count = await db
    .from('agent_actions')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', claims.org)
    .eq('run_date', claims.day)
    .eq('status', 'proposed')
    .eq('action_type', 'send_reminder');
  const p = await loadProfile(db, claims.org);
  if (b.confirm !== true)
    return json({
      pending: count.count ?? 0,
      business: p.legal_name ?? '',
      day: claims.day,
      test_mode: p.test_mode,
    });
  const done = await approveAll(db, claims.org, claims.day, 'owner:signed-link', env);
  const sent = await runSend(db, claims.org, env);
  return json({ approved: done.approved, send: sent });
});
