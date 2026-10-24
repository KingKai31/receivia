// Reads a buyer's pasted reply (English / Hindi / Marathi / Hinglish) and returns a checked reading.
// Writes nothing: the owner applies it in the app. Body: {org_id, customer_id, text}
import { cors, json } from '../_shared/http.ts';
import { agentEnv, authorize, serviceClient } from '../_shared/agent-auth.ts';
import {
  classifyReply,
  loadOpenInvoices,
  loadProfile,
  planDay,
} from '../_shared/agent.bundle.js';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const orgId = typeof b.org_id === 'string' ? b.org_id : null;
  const customerId = typeof b.customer_id === 'string' ? b.customer_id : null;
  const text = typeof b.text === 'string' ? b.text : '';
  if (!orgId || !customerId || !text.trim()) return json({ error: 'bad_request' }, 400);
  const who = await authorize(req, orgId);
  if (!who) return json({ error: 'unauthorized' }, 401);
  const db = serviceClient();
  const ok = await db.rpc('rate_limit_hit', {
    p_key: `classify:${orgId}`,
    p_max: 60,
    p_window_seconds: 3600,
  });
  if (ok.data === false) return json({ error: 'rate_limited' }, 429);
  try {
    const p = await loadProfile(db, orgId);
    const today = planDay(p, new Date());
    const invoices = await loadOpenInvoices(db, orgId, customerId);
    const fell: string[] = [];
    const result = await classifyReply(text, invoices, today, {
      anthropicKey: agentEnv().anthropicKey,
      onFallback: (w: string) => fell.push(w),
    });
    return json({
      result,
      today,
      invoices: invoices.map((i: { id: string; number: string; balancePaise: number }) => ({
        id: i.id,
        number: i.number,
        balance_paise: i.balancePaise,
      })),
    });
  } catch {
    return json({ error: 'failed' }, 500);
  }
});
