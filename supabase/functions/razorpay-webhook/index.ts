// Razorpay webhook: verifies the signature, then records the payment idempotently.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { json } from '../_shared/http.ts';
import { parsePaidEvent, verifyWebhookSignature } from '../_shared/razorpay.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const secret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET');
  const url = Deno.env.get('SUPABASE_URL');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret || !url || !service) return json({ error: 'not_configured' }, 503);

  const raw = await req.text();
  if (!(await verifyWebhookSignature(secret, raw, req.headers.get('x-razorpay-signature')))) {
    return json({ error: 'bad_signature' }, 401);
  }
  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const paid = parsePaidEvent(event);
  if (!paid) return json({ ok: true, ignored: true });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const res = await admin.rpc('record_gateway_payment', {
    p_invoice: paid.invoiceId,
    p_amount: paid.amountPaise,
    p_gateway_payment_id: paid.paymentId,
    p_paid_on: paid.paidOn,
  });
  if (res.error) {
    // Unknown invoice: acknowledge so Razorpay does not retry forever; anything else is retried.
    const unknown = res.error.code === 'P0002';
    return json({ error: unknown ? 'unknown_invoice' : 'failed' }, unknown ? 200 : 500);
  }
  return json({ ok: true, ...res.data });
});
