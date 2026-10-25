import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { paise, parseRupees, type Paise } from '@/lib/money';
import { supabase } from '@/lib/supabase';
import { validateGstin } from '@/lib/gstin';
import { ServiceError, unwrap, updateGuarded } from '@/lib/service/errors';

export interface BusinessProfile {
  id: string;
  org_id: string;
  legal_name: string;
  trade_name: string | null;
  gstin: string | null;
  state_code: string | null;
  registration_type: 'regular' | 'composition' | 'unregistered';
  annual_turnover_paise: number;
  udyam_number: string | null;
  enterprise_size: 'micro' | 'small' | 'medium' | null;
  activity: 'manufacturing' | 'services' | 'trading' | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  bank_name: string | null;
  bank_account_holder: string | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;
  upi_id: string | null;
  invoice_prefix: string;
  payability_threshold?: number;
  statement_monthly?: boolean;
  updated_at: string;
}

const blank = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

export const businessProfileSchema = z
  .object({
    legal_name: z.string().trim().min(1, 'Legal name is required'),
    trade_name: z.string().trim(),
    gstin: z
      .string()
      .trim()
      .toUpperCase()
      .refine((v) => v === '' || validateGstin(v).valid, 'Enter a valid 15-character GSTIN'),
    state_code: z.string(),
    registration_type: z.enum(['regular', 'composition', 'unregistered']),
    annual_turnover: z
      .string()
      .trim()
      .refine((v) => {
        if (v === '') return true;
        try {
          return parseRupees(v) >= 0;
        } catch {
          return false;
        }
      }, 'Enter an amount in rupees'),
    udyam_number: z
      .string()
      .trim()
      .toUpperCase()
      .refine(
        (v) => v === '' || /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/.test(v),
        'Format: UDYAM-MH-00-0000000',
      ),
    enterprise_size: z.enum(['', 'micro', 'small', 'medium']),
    activity: z.enum(['', 'manufacturing', 'services', 'trading']),
    address: z.string().trim(),
    email: z
      .string()
      .trim()
      .refine((v) => v === '' || /^\S+@\S+\.\S+$/.test(v), 'Enter a valid email'),
    phone: z.string().trim(),
    bank_name: z.string().trim(),
    bank_account_holder: z.string().trim(),
    bank_account_number: z.string().trim(),
    bank_ifsc: z
      .string()
      .trim()
      .toUpperCase()
      .refine((v) => v === '' || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v), 'IFSC looks like HDFC0001234'),
    upi_id: z
      .string()
      .trim()
      .refine(
        (v) => v === '' || /^[\w.-]{2,}@[A-Za-z]{2,}$/.test(v),
        'UPI ID looks like name@bank',
      ),
    invoice_prefix: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{1,4}$/, '1 to 4 letters or digits'),
  })
  .refine((v) => v.registration_type === 'unregistered' || v.gstin !== '', {
    path: ['gstin'],
    message: 'GSTIN is required for regular and composition businesses',
  });

export type BusinessProfileForm = z.infer<typeof businessProfileSchema>;

function rupeesText(p: number): string {
  if (p === 0) return '';
  const rem = p % 100;
  return `${Math.floor(p / 100)}${rem ? `.${String(rem).padStart(2, '0')}` : ''}`;
}

export function profileToForm(p: BusinessProfile): BusinessProfileForm {
  return {
    legal_name: p.legal_name,
    trade_name: p.trade_name ?? '',
    gstin: p.gstin ?? '',
    state_code: p.state_code ?? '',
    registration_type: p.registration_type,
    annual_turnover: rupeesText(p.annual_turnover_paise),
    udyam_number: p.udyam_number ?? '',
    enterprise_size: p.enterprise_size ?? '',
    activity: p.activity ?? '',
    address: p.address ?? '',
    email: p.email ?? '',
    phone: p.phone ?? '',
    bank_name: p.bank_name ?? '',
    bank_account_holder: p.bank_account_holder ?? '',
    bank_account_number: p.bank_account_number ?? '',
    bank_ifsc: p.bank_ifsc ?? '',
    upi_id: p.upi_id ?? '',
    invoice_prefix: p.invoice_prefix,
  };
}

/** Form values to DB columns. State is always derived from the GSTIN when there is one. */
export function formToPatch(f: BusinessProfileForm) {
  const g = f.gstin ? validateGstin(f.gstin) : null;
  if (g && !g.valid) throw new ServiceError('VALIDATION', 'Invalid GSTIN');
  const turnover: Paise = f.annual_turnover ? parseRupees(f.annual_turnover) : paise(0);
  return {
    legal_name: f.legal_name,
    trade_name: blank(f.trade_name),
    gstin: f.gstin || null,
    state_code: g && g.valid ? g.stateCode : f.state_code || null,
    registration_type: f.registration_type,
    annual_turnover_paise: turnover,
    udyam_number: blank(f.udyam_number),
    enterprise_size: f.enterprise_size || null,
    activity: f.activity || null,
    address: blank(f.address),
    email: blank(f.email),
    phone: blank(f.phone),
    bank_name: blank(f.bank_name),
    bank_account_holder: blank(f.bank_account_holder),
    bank_account_number: blank(f.bank_account_number),
    bank_ifsc: blank(f.bank_ifsc),
    upi_id: blank(f.upi_id),
    invoice_prefix: f.invoice_prefix,
  };
}

export async function getBusinessProfile(
  orgId: string,
  client: SupabaseClient = supabase,
): Promise<BusinessProfile> {
  return unwrap(
    await client.from('business_profile').select('*').eq('org_id', orgId).maybeSingle(),
  ) as BusinessProfile;
}

export async function saveBusinessProfile(
  profile: BusinessProfile,
  form: BusinessProfileForm,
  client: SupabaseClient = supabase,
): Promise<BusinessProfile> {
  return updateGuarded<BusinessProfile>(
    client,
    'business_profile',
    profile.id,
    profile.updated_at,
    formToPatch(form),
  );
}
