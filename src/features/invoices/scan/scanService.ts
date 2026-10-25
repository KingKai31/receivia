import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { ScannedInvoice } from './audit';

export const MAX_BYTES = 5 * 1024 * 1024;
export const PREFILL_KEY = 'receivia.scan.prefill';
const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

export class ScanError extends Error {}

async function toBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000)
    s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Sends the file to the read-invoice function. The file is not kept anywhere. */
export async function scanInvoiceFile(
  orgId: string,
  file: File,
  client: SupabaseClient = supabase,
): Promise<ScannedInvoice> {
  if (!TYPES.includes(file.type)) throw new ScanError('Use a JPG, PNG, WebP or PDF file.');
  if (file.size > MAX_BYTES)
    throw new ScanError('The file is over 5 MB. Use a smaller photo or PDF.');
  const res = await client.functions.invoke('read-invoice', {
    body: { org_id: orgId, media_type: file.type, data: await toBase64(file) },
  });
  if (res.error || !res.data?.scan)
    throw new ScanError('Could not read this invoice. Try a clearer photo, or enter it by hand.');
  return res.data.scan as ScannedInvoice;
}

/** Hands the reading to the New invoice form (same tab only). Never saves anything. */
export function stashPrefill(scan: ScannedInvoice): void {
  try {
    sessionStorage.setItem(PREFILL_KEY, JSON.stringify(scan));
  } catch {
    /* private window: the form opens empty */
  }
}
export function takePrefill(): ScannedInvoice | null {
  try {
    const v = sessionStorage.getItem(PREFILL_KEY);
    sessionStorage.removeItem(PREFILL_KEY);
    return v ? (JSON.parse(v) as ScannedInvoice) : null;
  } catch {
    return null;
  }
}
