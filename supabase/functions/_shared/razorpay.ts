// Pure Razorpay helpers (no Deno globals) so Vitest can test them.

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(body)));
}

/** Constant-time comparison of the X-Razorpay-Signature header with HMAC-SHA256(body, secret). */
export async function verifyWebhookSignature(
  secret: string,
  rawBody: string,
  signature: string | null,
): Promise<boolean> {
  if (!secret || !signature) return false;
  const expected = await hmacSha256Hex(secret, rawBody);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++)
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

export interface GatewayPayment {
  paymentId: string;
  invoiceId: string;
  amountPaise: number;
  paidOn: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Extracts a paid payment from a payment_link.paid or payment.captured event, else null. */
export function parsePaidEvent(body: unknown): GatewayPayment | null {
  const b = body as {
    event?: string;
    payload?: {
      payment?: {
        entity?: {
          id?: string;
          amount?: number;
          status?: string;
          created_at?: number;
          notes?: { invoice_id?: string };
        };
      };
      payment_link?: { entity?: { reference_id?: string; status?: string } };
    };
  };
  if (!b || (b.event !== 'payment_link.paid' && b.event !== 'payment.captured')) return null;
  const pay = b.payload?.payment?.entity;
  const link = b.payload?.payment_link?.entity;
  const invoiceId = link?.reference_id ?? pay?.notes?.invoice_id;
  if (!pay?.id || !Number.isSafeInteger(pay.amount) || (pay.amount as number) <= 0) return null;
  if (!invoiceId || !UUID.test(invoiceId)) return null;
  if (pay.status && pay.status !== 'captured' && pay.status !== 'paid') return null;
  const paidOn = pay.created_at
    ? new Date((pay.created_at + 19800) * 1000).toISOString().slice(0, 10)
    : null;
  return { paymentId: pay.id, invoiceId, amountPaise: pay.amount as number, paidOn };
}

export function isTestKey(keyId: string | undefined): boolean {
  return Boolean(keyId && keyId.startsWith('rzp_test_'));
}
