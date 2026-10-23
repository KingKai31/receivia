import type { SupabaseClient } from '@supabase/supabase-js';
import { calcLine } from '@/lib/gst';
import type { ISODate } from '@/lib/dates';
import { paise, parseRupees } from '@/lib/money';
import { ServiceError, fromPgError, unwrap } from '@/lib/service/errors';
import { supabase } from '@/lib/supabase';
import type { Invoice } from '@/features/invoices/invoiceService';

export interface Note {
  id: string;
  org_id: string;
  invoice_id: string;
  note_type: 'credit' | 'debit';
  number: string | null;
  issue_date: string;
  reason: string | null;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_paise: number;
  status: 'draft' | 'issued' | 'void';
  updated_at: string;
}

export interface NoteInput {
  type: 'credit' | 'debit';
  reason: string;
  /** Taxable value in typed rupees. */
  taxable: string;
  gstRate: number;
  issueDate: ISODate;
}

/** Amounts for a note against an invoice: same place of supply, so same CGST/SGST or IGST split. */
export function computeNote(
  invoice: Pick<
    Invoice,
    'supplier_state_code' | 'place_of_supply' | 'invoice_type' | 'total_paise'
  >,
  input: NoteInput,
) {
  if (!input.reason.trim()) throw new ServiceError('VALIDATION', 'Give a reason for the note.');
  let taxable;
  try {
    taxable = parseRupees(input.taxable);
  } catch (e) {
    throw new ServiceError('VALIDATION', (e as Error).message);
  }
  if (taxable <= 0) throw new ServiceError('VALIDATION', 'Amount must be more than zero.');
  const intra = invoice.supplier_state_code === invoice.place_of_supply;
  const collectsTax = invoice.invoice_type === 'tax_invoice';
  let r;
  try {
    r = calcLine({ qty: 1, rate: taxable, gstRate: input.gstRate }, intra, collectsTax);
  } catch (e) {
    throw new ServiceError('VALIDATION', (e as Error).message);
  }
  if (input.type === 'credit' && r.total > invoice.total_paise) {
    throw new ServiceError('VALIDATION', 'A credit note cannot be more than the invoice total.');
  }
  return {
    taxable_paise: r.taxable,
    cgst_paise: r.cgst,
    sgst_paise: r.sgst,
    igst_paise: r.igst,
    total_paise: paise(r.total),
  };
}

export async function createNoteDraft(
  orgId: string,
  invoice: Invoice,
  input: NoteInput,
  client: SupabaseClient = supabase,
): Promise<Note> {
  if (invoice.status === 'draft' || invoice.status === 'void') {
    throw new ServiceError('VALIDATION', 'Notes can only be raised against an issued invoice.');
  }
  const amounts = computeNote(invoice, input);
  return unwrap(
    await client
      .from('notes')
      .insert({
        org_id: orgId,
        invoice_id: invoice.id,
        note_type: input.type,
        issue_date: input.issueDate,
        reason: input.reason.trim(),
        status: 'draft',
        ...amounts,
      })
      .select()
      .single(),
  ) as Note;
}

export async function issueNote(
  note: Pick<Note, 'id' | 'updated_at'>,
  client: SupabaseClient = supabase,
): Promise<Note> {
  return unwrap(
    await client.rpc('issue_note', { p_note: note.id, p_expected: note.updated_at }),
  ) as Note;
}

export async function getNote(id: string, client: SupabaseClient = supabase): Promise<Note> {
  return unwrap(await client.from('notes').select('*').eq('id', id).maybeSingle()) as Note;
}

export async function listNotesForInvoice(
  invoiceId: string,
  client: SupabaseClient = supabase,
): Promise<Note[]> {
  const res = await client
    .from('notes')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('created_at', { ascending: true });
  if (res.error) throw fromPgError(res.error);
  return (res.data ?? []) as Note[];
}
