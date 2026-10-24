import type { SupabaseClient } from '@supabase/supabase-js';
import i18next from 'i18next';

export type ServiceErrorCode =
  'CONFLICT' | 'NOT_FOUND' | 'VALIDATION' | 'FORBIDDEN' | 'DUPLICATE' | 'UNKNOWN';

export const CONFLICT_MESSAGE =
  'Someone else changed this record while you were editing it. Reload to see the latest version, then make your change again.';

export class ServiceError extends Error {
  constructor(
    readonly code: ServiceErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

interface PgLike {
  code?: string;
  message?: string;
}

/** Maps a Postgres / PostgREST error to a typed ServiceError. */
export function fromPgError(e: PgLike): ServiceError {
  const msg = e.message ?? 'Unexpected database error';
  switch (e.code) {
    case '40001':
      return new ServiceError('CONFLICT', CONFLICT_MESSAGE, e);
    case '42501':
      return new ServiceError('FORBIDDEN', 'You do not have permission to do that.', e);
    case '23505':
      return new ServiceError('DUPLICATE', 'A record with the same value already exists.', e);
    case '23503':
    case '23514':
    case '23502':
    case '22P02':
    case '22023':
    case '22001':
      return new ServiceError('VALIDATION', msg, e);
    case 'P0002':
    case 'PGRST116':
      return new ServiceError('NOT_FOUND', 'Record not found.', e);
    default:
      return new ServiceError('UNKNOWN', msg, e);
  }
}

export function unwrap<T>(res: { data: T | null; error: PgLike | null }): T {
  if (res.error) throw fromPgError(res.error);
  if (res.data === null) throw new ServiceError('NOT_FOUND', 'Record not found.');
  return res.data;
}

/**
 * Optimistic concurrency: the update only applies if updated_at still matches what the caller
 * loaded. No row back means either the row is gone (or not visible) or someone changed it.
 */
export async function updateGuarded<T>(
  client: SupabaseClient,
  table: string,
  id: string,
  expectedUpdatedAt: string,
  patch: Record<string, unknown>,
): Promise<T> {
  const res = await client
    .from(table)
    .update(patch)
    .eq('id', id)
    .eq('updated_at', expectedUpdatedAt)
    .select()
    .maybeSingle();
  if (res.error) throw fromPgError(res.error);
  if (res.data) return res.data as T;
  const exists = await client.from(table).select('id').eq('id', id).maybeSingle();
  if (exists.error) throw fromPgError(exists.error);
  throw exists.data
    ? new ServiceError('CONFLICT', CONFLICT_MESSAGE)
    : new ServiceError('NOT_FOUND', 'Record not found.');
}

/** Escapes characters that are special inside a PostgREST ilike / or() filter. */
export function likeTerm(s: string): string {
  return s.replace(/[\\%_,()]/g, (c) => `\\${c}`);
}

export const PAGE_SIZE = 25;

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function range(page: number, pageSize = PAGE_SIZE): [number, number] {
  const from = Math.max(0, page) * pageSize;
  return [from, from + pageSize - 1];
}

/** True for a failed request caused by the network rather than the server. */
export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /failed to fetch|networkerror|load failed|network request failed/i.test(msg);
}

/**
 * Message for any thrown value, for toasts and inline errors. It says what happened and, where
 * there is something to do about it, how to fix it.
 */
export function errorMessage(e: unknown): string {
  const hints: Partial<Record<ServiceErrorCode, string>> = {
    FORBIDDEN: 'Ask the business owner to change your role if you need this.',
    NOT_FOUND: 'It may have been deleted. Go back to the list and refresh it.',
    DUPLICATE: 'Change the value, or open the existing record instead.',
    UNKNOWN: 'Try again. If it keeps happening, the problem has been recorded.',
  };
  let m: string;
  let hint: string | undefined;
  if (isNetworkError(e)) {
    m = 'Could not reach the server. Check your internet connection and try again.';
  } else if (e instanceof ServiceError) {
    m = e.message;
    hint = hints[e.code];
  } else if (e instanceof Error && e.message) {
    m = e.message;
  } else {
    m = 'Something went wrong. Try again.';
  }
  const tx = (x: string) => (i18next.isInitialized ? i18next.t(x) : x);
  return hint ? `${tx(m)} ${tx(hint)}` : tx(m);
}
