// Drafts reminder wording with the model (facts only, validated, falls back to the stage template).
// Body: {org_id, stage, language, tier, lens_allowed, business, customer_text?, history?, open_dispute?}
// Returns {subject, body, source, note, why}: `why` is the one-line reason for the tone.
import { cors, json } from '../_shared/http.ts';
import { agentEnv, authorize } from '../_shared/agent-auth.ts';
import { draftMessage } from '../_shared/agent.bundle.js';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const who = await authorize(req, typeof b.org_id === 'string' ? b.org_id : null);
  if (!who) return json({ error: 'unauthorized' }, 401);
  const stages = ['pre_due', 'due_today', 'overdue_firm', 'final', 'demand_letter'];
  const langs = ['en', 'hi', 'mr'];
  if (!stages.includes(String(b.stage)) || !langs.includes(String(b.language)))
    return json({ error: 'bad_request' }, 400);
  const r = await draftMessage(
    {
      stage: b.stage,
      language: b.language,
      tier: b.tier === 'key' ? 'key' : 'standard',
      lensAllowed: b.lens_allowed === true,
      business: String(b.business ?? '').slice(0, 80),
      customerText: typeof b.customer_text === 'string' ? b.customer_text : null,
      history: b.history && typeof b.history === 'object' ? b.history : null,
      openDispute: b.open_dispute === true,
    },
    { anthropicKey: agentEnv().anthropicKey },
  );
  return json(r);
});
