// Reads a photographed or PDF invoice with Claude vision and returns the printed values. Nothing is stored.
// The audit (GSTIN check digit, GST recompute) runs in the app from the same shared code. Body: {org_id, media_type, data (base64)}
import { cors, json } from '../_shared/http.ts';
import { agentEnv, authorize, serviceClient } from '../_shared/agent-auth.ts';
import { readInvoiceFile } from '../_shared/agent.bundle.js';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const orgId = typeof b.org_id === 'string' ? b.org_id : null;
  const mediaType = typeof b.media_type === 'string' ? b.media_type : '';
  const data = typeof b.data === 'string' ? b.data : '';
  if (!orgId || !data) return json({ error: 'bad_request' }, 400);
  const who = await authorize(req, orgId);
  if (!who) return json({ error: 'unauthorized' }, 401);
  const db = serviceClient();
  const ok = await db.rpc('rate_limit_hit', {
    p_key: `scan:${orgId}`,
    p_max: 30,
    p_window_seconds: 3600,
  });
  if (ok.data === false) return json({ error: 'rate_limited' }, 429);
  const r = await readInvoiceFile(
    { mediaType, base64: data },
    { anthropicKey: agentEnv().anthropicKey },
  );
  if (!r.ok) return json({ error: r.reason }, r.reason === 'unavailable' ? 503 : 422);
  return json({ scan: r.scan });
});
