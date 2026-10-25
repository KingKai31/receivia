// "Ask your books": the model may only call read-only typed tools; numbers are rendered from tool
// output. Writes nothing. Body: {org_id, question}
import { cors, json } from '../_shared/http.ts';
import { agentEnv, authorize, serviceClient } from '../_shared/agent-auth.ts';
import { askBooks, loadBooks, loadProfile, planDay } from '../_shared/agent.bundle.js';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const orgId = typeof b.org_id === 'string' ? b.org_id : null;
  const question = typeof b.question === 'string' ? b.question : '';
  if (!orgId || !question.trim()) return json({ error: 'bad_request' }, 400);
  const who = await authorize(req, orgId);
  if (!who) return json({ error: 'unauthorized' }, 401);
  const db = serviceClient();
  const ok = await db.rpc('rate_limit_hit', {
    p_key: `ask:${orgId}`,
    p_max: 60,
    p_window_seconds: 3600,
  });
  if (ok.data === false) return json({ error: 'rate_limited' }, 429);
  try {
    const p = await loadProfile(db, orgId);
    const data = await loadBooks(db, orgId, planDay(p, new Date()));
    const answer = await askBooks(question, data, { anthropicKey: agentEnv().anthropicKey });
    return json({ answer });
  } catch {
    return json({ error: 'failed' }, 500);
  }
});
