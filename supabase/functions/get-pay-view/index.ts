// Public: returns only the public fields of the invoice a pay token points at.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { clientIp, cors, json } from '../_shared/http.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const url = Deno.env.get('SUPABASE_URL');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !service) return json({ error: 'not_configured' }, 503);
  const admin = createClient(url, service, { auth: { persistSession: false } });

  const ok = await admin.rpc('rate_limit_hit', {
    p_key: `view:${clientIp(req)}`,
    p_max: 60,
    p_window_seconds: 60,
  });
  if (ok.error || ok.data !== true) return json({ error: 'rate_limited' }, 429);

  const { token } = await req.json().catch(() => ({ token: '' }));
  if (typeof token !== 'string' || token.length < 16 || token.length > 200) {
    return json({ error: 'not_found' }, 404);
  }
  const res = await admin.rpc('pay_view', { p_token: token });
  if (res.error) return json({ error: 'failed' }, 500);
  if (!res.data) return json({ error: 'not_found' }, 404);
  const extra = await admin.rpc('pay_extra_view', { p_token: token });
  return json({
    ...res.data,
    ...(extra.data ?? {}),
    razorpay: {
      configured: Boolean(Deno.env.get('RAZORPAY_KEY_ID') && Deno.env.get('RAZORPAY_KEY_SECRET')),
      test_mode: (Deno.env.get('RAZORPAY_KEY_ID') ?? '').startsWith('rzp_test_'),
    },
  });
});
