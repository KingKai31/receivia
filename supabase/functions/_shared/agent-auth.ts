import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { AgentEnv } from './agent.bundle.d.ts';

export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
}

export function agentEnv(): AgentEnv {
  const base = (Deno.env.get('APP_BASE_URL') ?? 'http://localhost:5173').replace(/\/$/, '');
  return {
    anthropicKey: Deno.env.get('ANTHROPIC_API_KEY') ?? null,
    resendKey: Deno.env.get('RESEND_API_KEY') ?? null,
    whatsappToken: Deno.env.get('WHATSAPP_TOKEN') ?? null,
    whatsappPhoneId: Deno.env.get('WHATSAPP_PHONE_ID') ?? null,
    appBaseUrl: base,
    functionsUrl: `${Deno.env.get('SUPABASE_URL')}/functions/v1`,
    signingSecret: Deno.env.get('APPROVAL_SIGNING_SECRET') ?? '',
    fromEmail: Deno.env.get('RESEND_FROM') ?? undefined,
  };
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** 'server' = caller holds AGENT_CRON_SECRET; otherwise the user's JWT must be owner/accountant of orgId. */
export async function authorize(
  req: Request,
  orgId: string | null,
): Promise<{ kind: 'server' } | { kind: 'user'; userId: string } | null> {
  const secret = Deno.env.get('AGENT_CRON_SECRET') ?? '';
  const given = req.headers.get('x-agent-secret') ?? '';
  if (given && same(given, secret)) return { kind: 'server' };
  const auth = req.headers.get('Authorization');
  if (!auth || !orgId) return null;
  const user = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const u = await user.auth.getUser();
  if (!u.data.user) return null;
  const m = await user
    .from('memberships')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', u.data.user.id)
    .maybeSingle();
  const role = (m.data as { role: string } | null)?.role;
  if (role !== 'owner' && role !== 'accountant') return null;
  return { kind: 'user', userId: u.data.user.id };
}
