import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { validateGstin } from '@/lib/gstin';
import { paise, parseRupees, type Paise } from '@/lib/money';
import {
  PAGE_SIZE,
  fromPgError,
  likeTerm,
  range,
  unwrap,
  updateGuarded,
  type Page,
} from '@/lib/service/errors';
import { supabase } from '@/lib/supabase';

export type EntityType = 'company' | 'firm' | 'proprietor' | 'government' | 'individual';

export interface Customer {
  id: string;
  org_id: string;
  name: string;
  gstin: string | null;
  state_code: string | null;
  credit_days: number;
  has_written_agreement: boolean;
  tier: 'key' | 'standard';
  language: 'en' | 'hi' | 'mr';
  entity_type: EntityType | null;
  is_psu: boolean;
  presumptive_tax: 'unknown' | 'yes' | 'no';
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  opt_in_whatsapp: boolean;
  opt_in_whatsapp_at: string | null;
  archived_at: string | null;
  snoozed_until: string | null;
  ap_name: string | null;
  ap_email: string | null;
  ap_phone: string | null;
  po_required: boolean;
  preferred_channel: 'email' | 'whatsapp' | 'sms' | null;
  cc_owner: boolean;
  credit_limit_paise: number | null;
  updated_at: string;
}

export const customerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === '' || validateGstin(v).valid, 'Enter a valid 15-character GSTIN'),
  state_code: z.string(),
  credit_days: z
    .string()
    .trim()
    .regex(/^\d{1,3}$/, 'Whole days, 0 to 365')
    .refine((v) => Number(v) <= 365, 'Whole days, 0 to 365'),
  has_written_agreement: z.boolean(),
  tier: z.enum(['standard', 'key']),
  language: z.enum(['en', 'hi', 'mr']),
  entity_type: z.enum(['', 'company', 'firm', 'proprietor', 'government', 'individual']),
  presumptive_tax: z.enum(['unknown', 'yes', 'no']),
  contact_name: z.string().trim(),
  email: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\S+@\S+\.\S+$/.test(v), 'Enter a valid email'),
  phone: z.string().trim(),
  address: z.string().trim(),
  opt_in_whatsapp: z.boolean(),
  is_psu: z.boolean(),
  ap_name: z.string().trim(),
  ap_email: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\S+@\S+\.\S+$/.test(v), 'Enter a valid email'),
  ap_phone: z.string().trim(),
  po_required: z.boolean(),
  preferred_channel: z.enum(['', 'email', 'whatsapp', 'sms']),
  cc_owner: z.boolean(),
  credit_limit: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d+(\.\d{1,2})?$/.test(v), 'Rupees, up to 2 decimals'),
});
export type CustomerForm = z.infer<typeof customerSchema>;

export const EMPTY_CUSTOMER: CustomerForm = {
  name: '',
  gstin: '',
  state_code: '',
  credit_days: '30',
  has_written_agreement: false,
  tier: 'standard',
  language: 'en',
  entity_type: '',
  presumptive_tax: 'unknown',
  contact_name: '',
  email: '',
  phone: '',
  address: '',
  opt_in_whatsapp: false,
  is_psu: false,
  ap_name: '',
  ap_email: '',
  ap_phone: '',
  po_required: false,
  preferred_channel: '',
  cc_owner: false,
  credit_limit: '',
};

const blank = (v: string) => (v.trim() ? v.trim() : null);

export function customerToForm(c: Customer): CustomerForm {
  return {
    name: c.name,
    gstin: c.gstin ?? '',
    state_code: c.state_code ?? '',
    credit_days: String(c.credit_days),
    has_written_agreement: c.has_written_agreement,
    tier: c.tier,
    language: c.language,
    entity_type: c.entity_type ?? '',
    presumptive_tax: c.presumptive_tax,
    contact_name: c.contact_name ?? '',
    email: c.email ?? '',
    phone: c.phone ?? '',
    address: c.address ?? '',
    opt_in_whatsapp: c.opt_in_whatsapp,
    is_psu: c.is_psu ?? false,
    ap_name: c.ap_name ?? '',
    ap_email: c.ap_email ?? '',
    ap_phone: c.ap_phone ?? '',
    po_required: c.po_required,
    preferred_channel: c.preferred_channel ?? '',
    cc_owner: c.cc_owner,
    credit_limit: c.credit_limit_paise === null ? '' : String(c.credit_limit_paise / 100),
  };
}

/** State comes from the GSTIN when present; otherwise the picked state (may be empty). */
export function formToRow(
  f: CustomerForm,
  previous?: Pick<Customer, 'opt_in_whatsapp' | 'opt_in_whatsapp_at'>,
) {
  const g = f.gstin ? validateGstin(f.gstin) : null;
  const optedInNow = f.opt_in_whatsapp && !previous?.opt_in_whatsapp;
  return {
    name: f.name,
    gstin: f.gstin || null,
    state_code: g && g.valid ? g.stateCode : f.state_code || null,
    credit_days: Number(f.credit_days),
    has_written_agreement: f.has_written_agreement,
    tier: f.tier,
    language: f.language,
    entity_type: f.entity_type || null,
    is_psu: f.is_psu,
    presumptive_tax: f.presumptive_tax,
    contact_name: blank(f.contact_name),
    email: blank(f.email),
    phone: blank(f.phone),
    address: blank(f.address),
    opt_in_whatsapp: f.opt_in_whatsapp,
    ap_name: blank(f.ap_name),
    ap_email: blank(f.ap_email),
    ap_phone: blank(f.ap_phone),
    po_required: f.po_required,
    preferred_channel: f.preferred_channel || null,
    cc_owner: f.cc_owner,
    credit_limit_paise: f.credit_limit ? parseRupees(f.credit_limit) : null,
    opt_in_whatsapp_at: f.opt_in_whatsapp
      ? optedInNow
        ? new Date().toISOString()
        : (previous?.opt_in_whatsapp_at ?? new Date().toISOString())
      : null,
  };
}

export async function listCustomers(
  args: { orgId: string; search?: string; page?: number; pageSize?: number },
  client: SupabaseClient = supabase,
): Promise<Page<Customer>> {
  const page = args.page ?? 0;
  const pageSize = args.pageSize ?? PAGE_SIZE;
  const [from, to] = range(page, pageSize);
  let q = client
    .from('customers')
    .select('*', { count: 'exact' })
    .eq('org_id', args.orgId)
    .is('archived_at', null)
    .order('name', { ascending: true })
    .range(from, to);
  const term = args.search?.trim();
  if (term) {
    const t = likeTerm(term);
    q = q.or(`name.ilike.%${t}%,gstin.ilike.%${t}%,phone.ilike.%${t}%`);
  }
  const res = await q;
  if (res.error) throw fromPgError(res.error);
  return { rows: (res.data ?? []) as Customer[], total: res.count ?? 0, page, pageSize };
}

export async function getCustomer(
  id: string,
  client: SupabaseClient = supabase,
): Promise<Customer> {
  return unwrap(await client.from('customers').select('*').eq('id', id).maybeSingle()) as Customer;
}

export async function createCustomer(
  orgId: string,
  form: CustomerForm,
  client: SupabaseClient = supabase,
): Promise<Customer> {
  return unwrap(
    await client
      .from('customers')
      .insert({ org_id: orgId, ...formToRow(form) })
      .select()
      .single(),
  ) as Customer;
}

export async function updateCustomer(
  current: Customer,
  form: CustomerForm,
  client: SupabaseClient = supabase,
): Promise<Customer> {
  return updateGuarded<Customer>(
    client,
    'customers',
    current.id,
    current.updated_at,
    formToRow(form, current),
  );
}

export interface CustomerPayment {
  id: string;
  amount_paise: number;
  received_on: string;
  method: string;
  reference: string | null;
  status: string;
}

export interface CustomerSummary {
  owed: Paise;
  openInvoices: number;
  payments: CustomerPayment[];
}

/** Total owed = unpaid part of issued and part-paid invoices, plus the 20 latest payments. */
export async function customerSummary(
  customerId: string,
  client: SupabaseClient = supabase,
): Promise<CustomerSummary> {
  const [inv, pay] = await Promise.all([
    client
      .from('invoices')
      .select('balance_paise')
      .eq('customer_id', customerId)
      .in('status', ['issued', 'partially_paid'])
      .limit(5000),
    client
      .from('payments')
      .select('id, amount_paise, received_on, method, reference, status')
      .eq('customer_id', customerId)
      .order('received_on', { ascending: false })
      .limit(20),
  ]);
  if (inv.error) throw fromPgError(inv.error);
  if (pay.error) throw fromPgError(pay.error);
  const rows = (inv.data ?? []) as { balance_paise: number }[];
  return {
    owed: paise(rows.reduce((s, r) => s + r.balance_paise, 0)),
    openInvoices: rows.length,
    payments: (pay.data ?? []) as CustomerPayment[],
  };
}
