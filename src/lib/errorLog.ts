import { supabase } from '@/lib/supabase';

// Errors seen in the browser are saved to the app_errors table so they can be fixed.
// Only the page address, the message and the stack are sent: never form values or business data.
let orgId: string | null = null;
const recent = new Map<string, number>();
let sentInWindow: number[] = [];

export function setErrorContext(id: string | null): void {
  orgId = id;
}

/** At most 5 reports a minute, and the same message only once a minute. */
export function shouldReport(message: string, now = Date.now()): boolean {
  sentInWindow = sentInWindow.filter((t) => now - t < 60_000);
  if (sentInWindow.length >= 5) return false;
  const last = recent.get(message);
  if (last !== undefined && now - last < 60_000) return false;
  recent.set(message, now);
  sentInWindow.push(now);
  return true;
}

export async function logError(error: unknown, route = window.location.pathname): Promise<void> {
  const e = error instanceof Error ? error : new Error(String(error));
  if (!orgId || !shouldReport(e.message)) return;
  try {
    await supabase.from('app_errors').insert({
      org_id: orgId,
      route: route.slice(0, 300),
      message: e.message.slice(0, 1000),
      stack: e.stack?.slice(0, 4000) ?? null,
      user_agent: navigator.userAgent.slice(0, 300),
    });
  } catch {
    /* logging must never throw */
  }
}

let installed = false;
export function installGlobalErrorLogging(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (ev) => void logError(ev.error ?? ev.message));
  window.addEventListener('unhandledrejection', (ev) => void logError(ev.reason));
}
