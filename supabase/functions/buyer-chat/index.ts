// Public: "Talk to accounts" on the pay page. The token is the only credential.
// The model may only call the five negotiation tools; every limit is enforced in the database
// (neg_apply). Every turn and tool call is logged. Body: {token, message?} (no message = status only)
import { clientIp, cors, json } from '../_shared/http.ts';
import { agentEnv, serviceClient } from '../_shared/agent-auth.ts';
import { negotiate } from '../_shared/agent.bundle.js';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const token = typeof b.token === 'string' ? b.token : '';
  if (token.length < 16 || token.length > 200) return json({ error: 'not_found' }, 404);
  const message = typeof b.message === 'string' ? b.message.trim().slice(0, 500) : '';
  const db = serviceClient();

  const rl = await db.rpc('rate_limit_hit', {
    p_key: `chat:${clientIp(req)}`,
    p_max: 30,
    p_window_seconds: 600,
  });
  if (rl.error || rl.data !== true) return json({ error: 'rate_limited' }, 429);

  const ctxRes = await db.rpc('neg_context', { p_token: token });
  if (ctxRes.error)
    return json(
      { error: ctxRes.error.code === '42501' ? 'not_found' : 'failed' },
      ctxRes.error.code === '42501' ? 404 : 500,
    );
  const ctx = ctxRes.data;
  if (!ctx) return json({ error: 'not_found' }, 404);
  const env = agentEnv();
  const available = Boolean(ctx.enabled && env.anthropicKey);
  if (!message) return json({ enabled: available, history: ctx.history });
  if (!available) return json({ enabled: false });

  const perToken = await db.rpc('rate_limit_hit', {
    p_key: `chat-t:${token.slice(0, 16)}`,
    p_max: 40,
    p_window_seconds: 3600,
  });
  if (perToken.error || perToken.data !== true) return json({ error: 'rate_limited' }, 429);

  await db.rpc('neg_log', { p_token: token, p_role: 'buyer', p_content: message });
  const result = await negotiate({
    message,
    ctx,
    env: { anthropicKey: env.anthropicKey },
    apply: async (tool: string, args: Record<string, unknown>) => {
      const r = await db.rpc('neg_apply', { p_token: token, p_tool: tool, p_args: args });
      if (r.error || !r.data) return { ok: false, message: 'That could not be done right now.' };
      return r.data;
    },
  });
  if (result.source !== 'ai') return json({ enabled: true, unavailable: true });
  await db.rpc('neg_log', { p_token: token, p_role: 'assistant', p_content: result.reply });
  return json({ enabled: true, reply: result.reply, actions: result.actions });
});
