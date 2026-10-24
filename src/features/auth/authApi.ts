import { clearSnapshot } from '@/lib/offline';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';

export type AuthErrorCode =
  'INVALID_EMAIL' | 'OTP_SEND_FAILED' | 'OTP_INVALID' | 'DEMO_UNAVAILABLE';

export class AuthFlowError extends Error {
  readonly code: AuthErrorCode;
  constructor(code: AuthErrorCode) {
    super(code);
    this.name = 'AuthFlowError';
    this.code = code;
  }
}

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email());
export const otpSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/);

export async function sendOtp(email: string): Promise<void> {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) throw new AuthFlowError('INVALID_EMAIL');
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: { shouldCreateUser: true },
  });
  if (error) throw new AuthFlowError('OTP_SEND_FAILED');
}

export async function verifyOtp(email: string, code: string): Promise<void> {
  const e = emailSchema.safeParse(email);
  const c = otpSchema.safeParse(code);
  if (!e.success || !c.success) throw new AuthFlowError('OTP_INVALID');
  const { error } = await supabase.auth.verifyOtp({ email: e.data, token: c.data, type: 'email' });
  if (error) throw new AuthFlowError('OTP_INVALID');
}

/** Signs in as the shared demo user through the demo-login edge function. */
export async function openLiveDemo(): Promise<void> {
  const { data, error } = await supabase.functions.invoke<{
    access_token?: string;
    refresh_token?: string;
  }>('demo-login', { method: 'POST' });
  if (error || !data?.access_token || !data.refresh_token) {
    throw new AuthFlowError('DEMO_UNAVAILABLE');
  }
  const set = await supabase.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });
  if (set.error) throw new AuthFlowError('DEMO_UNAVAILABLE');
}

export async function signOut(): Promise<void> {
  await clearSnapshot();
  await supabase.auth.signOut();
}
