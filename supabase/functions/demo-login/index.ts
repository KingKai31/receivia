// "Open live demo": signs the shared demo user in and returns a session.
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (provided by Supabase),
// DEMO_EMAIL, DEMO_PASSWORD (set as function secrets).
import { createClient } from 'npm:@supabase/supabase-js@2';

const DEMO_ORG_ID = '00000000-0000-4000-8000-00000000de60';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const email = Deno.env.get('DEMO_EMAIL');
  const password = Deno.env.get('DEMO_PASSWORD');
  if (!url || !anon || !service || !email || !password) {
    return json({ error: 'demo_not_configured' }, 503);
  }

  const admin = createClient(url, service, { auth: { persistSession: false } });

  // Idempotent setup: demo org, demo user, accountant membership.
  await admin.from('orgs').upsert({ id: DEMO_ORG_ID, name: 'Shree Ganesh Corrugators' }, { onConflict: 'id' });

  const client = createClient(url, anon, { auth: { persistSession: false } });
  let signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) {
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { demo: true },
    });
    if (created.error && !/already|registered/i.test(created.error.message)) {
      return json({ error: 'demo_user_failed' }, 500);
    }
    signIn = await client.auth.signInWithPassword({ email, password });
  }
  if (signIn.error || !signIn.data.session || !signIn.data.user) {
    return json({ error: 'demo_sign_in_failed' }, 500);
  }

  // Accountant, not owner: the public demo cannot change the org, members or business profile.
  const member = await admin
    .from('memberships')
    .upsert(
      { org_id: DEMO_ORG_ID, user_id: signIn.data.user.id, role: 'accountant' },
      { onConflict: 'org_id,user_id' },
    );
  if (member.error) return json({ error: 'demo_membership_failed' }, 500);

  const { access_token, refresh_token } = signIn.data.session;
  return json({ access_token, refresh_token });
});
