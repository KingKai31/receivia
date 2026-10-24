// Public: buyer actions from the pay page (already paid, something is wrong, promise a date).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { clientIp, cors, json } from '../_shared/http.ts';

const KINDS = ['paid', 'dispute', 'promise'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const url = Deno.env.get('SUPABASE_URL');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !service) return json({ error: 'not_configured' }, 503);
  const admin = createClient(url, service, { auth: { persistSession: false } });

  const ok = await admin.rpc('rate_limit_hit', {
    p_key: `act:${clientIp(req)}`,
    p_max: 10,
    p_window_seconds: 600,
  });
  if (ok.error || ok.data !== true) return json({ error: 'rate_limited' }, 429);

  const body = await req.json().catch(() => null);
  if (!body || typeof body.token !== 'string' || !KINDS.includes(body.kind)) {
    return json({ error: 'bad_request' }, 400);
  }
  const payload = typeof body.payload === 'object' && body.payload ? body.payload : {};
  const res = await admin.rpc('pay_action', {
    p_token: body.token,
    p_kind: body.kind,
    p_payload: payload,
  });
  if (res.error) {
    const code = res.error.code;
    if (code === '42501') return json({ error: 'not_found' }, 404);
    if (code === '22023') return json({ error: 'invalid', message: res.error.message }, 400);
    return json({ error: 'failed' }, 500);
  }
  return json({ ok: true });
});
