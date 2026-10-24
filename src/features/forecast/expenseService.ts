import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { parseRupees } from '@/lib/money';
import { PAGE_SIZE, fromPgError, range, updateGuarded, type Page } from '@/lib/service/errors';
import { supabase } from '@/lib/supabase';
import type { ExpenseRow } from './forecastService';

export const EXPENSE_KINDS = [
  { value: 'salary', label: 'Salaries' },
  { value: 'rent', label: 'Rent' },
  { value: 'tax', label: 'GST or other tax' },
  { value: 'supplier', label: 'Supplier bill' },
  { value: 'utility', label: 'Electricity, phone, internet' },
  { value: 'other', label: 'Other' },
] as const;

export const RECURRENCES = [
  { value: '', label: 'One-off' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
  { value: 'quarterly', label: 'Every 3 months' },
  { value: 'yearly', label: 'Every year' },
] as const;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date');

export const expenseSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required'),
    kind: z.enum(['salary', 'rent', 'tax', 'supplier', 'utility', 'other']),
    amount: z
      .string()
      .trim()
      .refine((v) => {
        try {
          return parseRupees(v) > 0;
        } catch {
          return false;
        }
      }, 'Enter an amount in rupees, like 240000 or 1,500.50'),
    recurrence: z.enum(['', 'weekly', 'monthly', 'quarterly', 'yearly']),
    /** First (or only) due date. */
    date,
    endsOn: z.string().refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Pick a date'),
    deferrable: z.boolean(),
  })
  .refine((v) => v.endsOn === '' || v.endsOn >= v.date, {
    message: 'End date is before the first date',
    path: ['endsOn'],
  });

export type ExpenseForm = z.infer<typeof expenseSchema>;

export const EMPTY_EXPENSE: ExpenseForm = {
  name: '',
  kind: 'other',
  amount: '',
  recurrence: '',
  date: '',
  endsOn: '',
  deferrable: false,
};

export function rowToForm(r: ExpenseRow): ExpenseForm {
  return {
    name: r.name,
    kind: (r.kind as ExpenseForm['kind']) ?? 'other',
    amount: String(r.amount_paise / 100),
    recurrence: r.recurrence ?? '',
    date: r.is_recurring ? (r.next_due ?? r.expense_date) : r.expense_date,
    endsOn: r.ends_on ?? '',
    deferrable: r.can_defer,
  };
}

export function formToRow(f: ExpenseForm) {
  const recurring = f.recurrence !== '';
  return {
    name: f.name,
    kind: f.kind,
    category: f.kind,
    amount_paise: Number(parseRupees(f.amount)),
    expense_date: f.date,
    is_recurring: recurring,
    recurrence: recurring ? f.recurrence : null,
    next_due: recurring ? f.date : null,
    ends_on: recurring && f.endsOn ? f.endsOn : null,
    can_defer: f.deferrable,
  };
}

export async function listExpenses(
  args: { orgId: string; page?: number; pageSize?: number },
  client: SupabaseClient = supabase,
): Promise<Page<ExpenseRow>> {
  const page = args.page ?? 0;
  const pageSize = args.pageSize ?? PAGE_SIZE;
  const [from, to] = range(page, pageSize);
  const r = await client
    .from('expenses')
    .select('*', { count: 'exact' })
    .eq('org_id', args.orgId)
    .order('active', { ascending: false })
    .order('is_recurring', { ascending: false })
    .order('expense_date', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to);
  if (r.error) throw fromPgError(r.error);
  return { rows: (r.data ?? []) as ExpenseRow[], total: r.count ?? 0, page, pageSize };
}

export async function createExpense(
  orgId: string,
  f: ExpenseForm,
  client: SupabaseClient = supabase,
) {
  const r = await client.from('expenses').insert({ org_id: orgId, ...formToRow(f) });
  if (r.error) throw fromPgError(r.error);
}

export async function updateExpense(
  e: { id: string; updated_at: string },
  f: ExpenseForm,
  client: SupabaseClient = supabase,
) {
  return updateGuarded(client, 'expenses', e.id, e.updated_at, formToRow(f));
}

export async function setExpenseActive(
  e: { id: string; updated_at: string },
  active: boolean,
  client: SupabaseClient = supabase,
) {
  return updateGuarded(client, 'expenses', e.id, e.updated_at, { active });
}

export async function deleteExpense(orgId: string, id: string, client: SupabaseClient = supabase) {
  const r = await client.from('expenses').delete().eq('org_id', orgId).eq('id', id);
  if (r.error) throw fromPgError(r.error);
}
