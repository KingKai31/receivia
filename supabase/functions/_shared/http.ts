export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for') ?? req.headers.get('cf-connecting-ip') ?? '';
  return fwd.split(',')[0]?.trim() || 'unknown';
}
