import { describe, expect, it } from 'vitest';
import {
  hmacSha256Hex,
  isTestKey,
  parsePaidEvent,
  verifyWebhookSignature,
} from '../../../supabase/functions/_shared/razorpay';

const INV = '3f2b8c1e-5a4d-4c7e-9b1a-0d2e4f6a8b10';
const event = (over: Record<string, unknown> = {}) => ({
  event: 'payment_link.paid',
  payload: {
    payment: { entity: { id: 'pay_ABC123', amount: 118000, status: 'captured', created_at: 1_790_000_000 } },
    payment_link: { entity: { reference_id: INV, status: 'paid' } },
  },
  ...over,
});

describe('razorpay webhook helpers', () => {
  it('accepts a correct HMAC signature and rejects wrong, missing or tampered ones', async () => {
    const body = JSON.stringify(event());
    const sig = await hmacSha256Hex('whsec_test', body);
    expect(await verifyWebhookSignature('whsec_test', body, sig)).toBe(true);
    expect(await verifyWebhookSignature('whsec_test', body + ' ', sig)).toBe(false);
    expect(await verifyWebhookSignature('other', body, sig)).toBe(false);
    expect(await verifyWebhookSignature('whsec_test', body, null)).toBe(false);
    expect(await verifyWebhookSignature('whsec_test', body, sig.slice(0, -1))).toBe(false);
    expect(await verifyWebhookSignature('', body, sig)).toBe(false);
  });
  it('matches a known HMAC-SHA256 vector', async () => {
    expect(await hmacSha256Hex('key', 'The quick brown fox jumps over the lazy dog')).toBe(
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
    );
  });
  it('parses a paid event into invoice id, payment id, paise and IST date', () => {
    expect(parsePaidEvent(event())).toEqual({
      paymentId: 'pay_ABC123', invoiceId: INV, amountPaise: 118000, paidOn: '2026-09-21',
    });
  });
  it('ignores other events, failed payments, bad amounts and non-uuid references', () => {
    expect(parsePaidEvent(event({ event: 'payment.failed' }))).toBeNull();
    expect(parsePaidEvent(null)).toBeNull();
    const bad = (patch: (e: ReturnType<typeof event>) => void) => {
      const e = event();
      patch(e);
      return parsePaidEvent(e);
    };
    expect(bad((e) => (e.payload.payment.entity.status = 'failed'))).toBeNull();
    expect(bad((e) => (e.payload.payment.entity.amount = 0))).toBeNull();
    expect(bad((e) => (e.payload.payment.entity.amount = 10.5))).toBeNull();
    expect(bad((e) => (e.payload.payment_link.entity.reference_id = 'not-a-uuid'))).toBeNull();
  });
  it('detects test keys', () => {
    expect(isTestKey('rzp_test_abc')).toBe(true);
    expect(isTestKey('rzp_live_abc')).toBe(false);
    expect(isTestKey(undefined)).toBe(false);
  });
});
