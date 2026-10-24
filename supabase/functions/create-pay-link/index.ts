// Owner/accountant: creates a pay token (sha256 stored, 60 day expiry) and, when Razorpay keys exist,
// a Razorpay Payment Link with reference_id = invoice id.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { cors, json } from '../_shared/http.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const auth = req.headers.get('Authorization');
  if (!url || !anon || !service) return json({ error: 'not_configured' }, 503);
  if (!auth) return json({ error: 'unauthorized' }, 401);

  const { invoice_id: invoiceId } = await req.json().catch(() => ({ invoice_id: '' }));
  if (typeof invoiceId !== 'string') return json({ error: 'bad_request' }, 400);

  // The caller's own JWT: RLS and create_pay_token's can_write check decide who may do this.
  const user = createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const tok = await user.rpc('create_pay_token', { p_invoice: invoiceId, p_ttl: '60 days' });
  if (tok.error) {
    const denied = tok.error.code === '42501';
    return json({ error: denied ? 'forbidden' : 'failed' }, denied ? 403 : 500);
  }
  const token = tok.data as string;
  const base = Deno.env.get('APP_BASE_URL') ?? '';
  const payUrl = `${base}/pay/${token}`;

  const keyId = Deno.env.get('RAZORPAY_KEY_ID');
  const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET');
  let razorpay: 'ok' | 'not_configured' | 'failed' = 'not_configured';
  if (keyId && keySecret) {
    const inv = await user
      .from('invoices')
      .select('id, number, balance_paise, razorpay_link_id')
      .eq('id', invoiceId)
      .maybeSingle();
    if (inv.data && inv.data.balance_paise > 0) {
      if (inv.data.razorpay_link_id) {
        razorpay = 'ok';
      } else {
        const r = await fetch('https://api.razorpay.com/v1/payment_links', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`,
          },
          body: JSON.stringify({
            amount: inv.data.balance_paise,
            currency: 'INR',
            reference_id: inv.data.id,
            description: `Invoice ${inv.data.number}`,
            callback_url: payUrl,
            callback_method: 'get',
            notes: { invoice_id: inv.data.id },
          }),
        });
        if (r.ok) {
          const link = await r.json();
          const admin = createClient(url, service, { auth: { persistSession: false } });
          await admin
            .from('invoices')
            .update({ razorpay_link_id: link.id, razorpay_link_url: link.short_url })
            .eq('id', invoiceId);
          razorpay = 'ok';
        } else {
          razorpay = 'failed';
        }
      }
    }
  }
  return json({ url: payUrl, razorpay });
});
