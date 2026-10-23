import { describe, expect, it } from 'vitest';
import { AuthFlowError, emailSchema, otpSchema, sendOtp, verifyOtp } from './authApi';

describe('auth input rules', () => {
  it('normalises and validates email', () => {
    expect(emailSchema.parse('  Owner@Example.IN ')).toBe('owner@example.in');
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
  });
  it('accepts only 6-digit codes', () => {
    expect(otpSchema.safeParse('123456').success).toBe(true);
    for (const bad of ['12345', '1234567', 'abcdef', '']) {
      expect(otpSchema.safeParse(bad).success).toBe(false);
    }
  });
  it('rejects bad input with typed errors before any network call', async () => {
    await expect(sendOtp('nope')).rejects.toMatchObject({ code: 'INVALID_EMAIL' });
    await expect(verifyOtp('a@b.in', '12')).rejects.toBeInstanceOf(AuthFlowError);
    await expect(verifyOtp('a@b.in', '12')).rejects.toMatchObject({ code: 'OTP_INVALID' });
  });
});
