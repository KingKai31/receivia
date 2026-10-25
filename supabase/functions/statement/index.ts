// Public: the buyer's statement of account. {token} returns the ledger; {token, kind, payload} confirms
// the balance or disputes a line. The token is the only credential.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { clientIp, cors, json } from '../_shared/http.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const url = Deno.env.get('SUPABASE_URL');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !service) return json({ error: 'not_configured' }, 503);
  const admin = createClient(url, service, { auth: { persistSession: false } });

  const body = await req.json().catch(() => null);
  if (
    !body ||
    typeof body.token !== 'string' ||
    body.token.length < 16 ||
    body.token.length > 200
  ) {
    return json({ error: 'not_found' }, 404);
  }
  const acting = typeof body.kind === 'string';
  const ok = await admin.rpc('rate_limit_hit', {
    p_key: `${acting ? 'stmt-act' : 'stmt-view'}:${clientIp(req)}`,
    p_max: acting ? 10 : 60,
    p_window_seconds: acting ? 600 : 60,
  });
  if (ok.error || ok.data !== true) return json({ error: 'rate_limited' }, 429);

  if (!acting) {
    const res = await admin.rpc('statement_view', { p_token: body.token });
    if (res.error) return json({ error: 'failed' }, 500);
    if (!res.data) return json({ error: 'not_found' }, 404);
    return json(res.data);
  }
  if (!['confirm', 'dispute_line'].includes(body.kind)) return json({ error: 'bad_request' }, 400);
  const res = await admin.rpc('statement_action', {
    p_token: body.token,
    p_kind: body.kind,
    p_payload: typeof body.payload === 'object' && body.payload ? body.payload : {},
  });
  if (res.error) {
    if (res.error.code === '42501') return json({ error: 'not_found' }, 404);
    if (res.error.code === '22023')
      return json({ error: 'invalid', message: res.error.message }, 400);
    return json({ error: 'failed' }, 500);
  }
  return json({ ok: true });
});
