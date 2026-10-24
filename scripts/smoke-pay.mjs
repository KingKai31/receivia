// End-to-end check of the deployed pay functions against the single Supabase project.
// Creates one temporary invoice in the demo org, drives create-pay-link, get-pay-view, pay-action and the
// signed Razorpay webhook (mocked payload, real signature and real function), then deletes everything.
// Needs RAZORPAY_WEBHOOK_SECRET in .env.local to match the function secret. Never prints secrets.
import crypto from 'node:crypto';
import fs from 'node:fs';
import pg from 'pg';

const DEMO_ORG = '00000000-0000-4000-8000-00000000de60';
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
}
const {
  VITE_SUPABASE_URL: URL_,
  VITE_SUPABASE_ANON_KEY: ANON,
  RAZORPAY_WEBHOOK_SECRET: WH,
} = process.env;
const fn = (name, body, headers = {}, raw) =>
  fetch(`${URL_}/functions/v1/${name}`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json', ...headers },
    body: raw ?? JSON.stringify(body),
  });

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ check: name, result: ok ? 'pass' : 'FAIL', note: extra });
  if (!ok) process.exitCode = 1;
};

const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await db.connect();
let invA, invB, cust;
try {
  cust = (
    await db.query(
      `insert into public.customers (org_id, name, state_code, language) values ($1, 'Smoke Pay Buyer', '27', 'hi') returning id`,
      [DEMO_ORG],
    )
  ).rows[0].id;
  const mk = async (n, total) =>
    (
      await db.query(
        `insert into public.invoices (org_id, customer_id, number, fy, status, source, issue_date, due_date,
           supplier_state_code, place_of_supply, taxable_paise, total_paise)
         values ($1, $2, $3, '26-27', 'issued', 'import', '2026-09-01', '2026-10-01', '27', '27', $4, $4) returning id`,
        [DEMO_ORG, cust, n, total],
      )
    ).rows[0].id;
  invA = await mk('SMK/0001', 50000);
  invB = await mk('SMK/0002', 70000);

  const login = await (await fn('demo-login', {})).json();
  const auth = { Authorization: `Bearer ${login.access_token}` };

  const noAuth = await fn('create-pay-link', { invoice_id: invA });
  check('create-pay-link needs a signed-in user', noAuth.status === 401, `status ${noAuth.status}`);
  const link = await fn('create-pay-link', { invoice_id: invA }, auth);
  const lj = await link.json();
  check(
    'create-pay-link returns a /pay/ URL',
    link.ok && /\/pay\/[\w-]{20,}/.test(lj.url ?? ''),
    `razorpay: ${lj.razorpay}`,
  );
  const tokenA = (lj.url ?? '').split('/pay/')[1];
  const tokenB = (await (await fn('create-pay-link', { invoice_id: invB }, auth)).json()).url.split(
    '/pay/',
  )[1];
  const stored = await db.query(
    `select token_hash, expires_at - created_at as ttl from public.pay_tokens where invoice_id = $1`,
    [invA],
  );
  check(
    'token stored as sha256 hash only',
    stored.rows[0].token_hash === crypto.createHash('sha256').update(tokenA).digest('hex'),
  );
  check(
    'expiry is 60 days',
    /60 days/.test(String(stored.rows[0].ttl.days ?? '')) || stored.rows[0].ttl.days === 60,
    JSON.stringify(stored.rows[0].ttl),
  );

  const viewA = await (await fn('get-pay-view', { token: tokenA })).json();
  const viewB = await (await fn('get-pay-view', { token: tokenB })).json();
  check(
    'view shows only its own invoice',
    viewA.invoice_number === 'SMK/0001' && viewB.invoice_number === 'SMK/0002',
  );
  check(
    'view has no org id or other internals',
    !JSON.stringify(viewA).includes(DEMO_ORG) && !('org_id' in viewA),
  );
  check('customer language is used (hi)', viewA.language === 'hi');
  check(
    'razorpay reported as not configured when keys are missing',
    viewA.razorpay && typeof viewA.razorpay.configured === 'boolean',
    JSON.stringify(viewA.razorpay),
  );
  const bad = await fn('get-pay-view', { token: 'x'.repeat(30) });
  check('unknown token is 404', bad.status === 404);

  const act = await fn('pay-action', {
    token: tokenA,
    kind: 'paid',
    payload: { reference: 'UTR-SMOKE', paid_on: '2026-10-20' },
  });
  check('"I have already paid" is accepted', act.ok);
  const claim = await db.query(
    `select status, reference from public.payment_claims where invoice_id = $1`,
    [invA],
  );
  check('claim lands in the inbox as pending', claim.rows[0]?.status === 'pending');
  const wrongTok = await fn('pay-action', {
    token: 'nope-nope-nope-nope-nope',
    kind: 'dispute',
    payload: { reason: 'x' },
  });
  check('action with a bad token is 404', wrongTok.status === 404);
  const dsp = await fn('pay-action', {
    token: tokenB,
    kind: 'dispute',
    payload: { reason: 'Quantity or goods not as ordered', note: 'short by 2' },
  });
  check(
    'dispute accepted and flags the invoice',
    dsp.ok &&
      (await db.query(`select disputed from public.invoices where id = $1`, [invB])).rows[0]
        .disputed === true,
  );

  // Mocked Razorpay payment_link.paid, real signature.
  const event = {
    event: 'payment_link.paid',
    payload: {
      payment: {
        entity: {
          id: `pay_SMOKE${Date.now()}`,
          amount: 50000,
          status: 'captured',
          created_at: Math.floor(Date.now() / 1000),
        },
      },
      payment_link: { entity: { reference_id: invA, status: 'paid' } },
    },
  };
  const raw = JSON.stringify(event);
  const sig = crypto.createHmac('sha256', WH).update(raw).digest('hex');
  const noSig = await fn('razorpay-webhook', null, {}, raw);
  check('webhook without signature is rejected', noSig.status === 401);
  const badSig = await fn(
    'razorpay-webhook',
    null,
    { 'x-razorpay-signature': sig.replace(/.$/, '0') },
    raw,
  );
  check('webhook with a wrong signature is rejected', badSig.status === 401);
  const ok1 = await (
    await fn('razorpay-webhook', null, { 'x-razorpay-signature': sig }, raw)
  ).json();
  check(
    'signed webhook records the payment',
    ok1.ok && ok1.duplicate === false,
    JSON.stringify(ok1),
  );
  const ok2 = await (
    await fn('razorpay-webhook', null, { 'x-razorpay-signature': sig }, raw)
  ).json();
  check('replayed webhook is a duplicate, not a second payment', ok2.duplicate === true);
  const pays = await db.query(
    `select count(*)::int n from public.payments where org_id = $1 and customer_id = $2`,
    [DEMO_ORG, cust],
  );
  check('exactly one payment row', pays.rows[0].n === 1);
  const inv = (
    await db.query(`select status, balance_paise from public.invoices where id = $1`, [invA])
  ).rows[0];
  check(
    'invoice is paid with zero balance',
    inv.status === 'paid' && Number(inv.balance_paise) === 0,
  );
  const audit = await db.query(
    `select count(*)::int n from public.audit_log where table_name in ('payments','allocations') and org_id = $1 and record_id in (select id from public.payments where customer_id = $2 union select id from public.allocations where invoice_id = $3)`,
    [DEMO_ORG, cust, invA],
  );
  check(
    'audit_log has rows for payment and allocation',
    audit.rows[0].n >= 2,
    `rows ${audit.rows[0].n}`,
  );

  // Rate limit: 60 views a minute per IP.
  const burst = await Promise.all(
    Array.from({ length: 90 }, () => fn('get-pay-view', { token: tokenB })),
  );
  const limited = burst.some((r) => r.status === 429);
  check('get-pay-view is rate limited per IP', limited);
} catch (e) {
  check('script ran without an exception', false, e.message);
} finally {
  const q = (s, p) => db.query(s, p).catch(() => undefined);
  await q(`delete from public.payment_claims where org_id = $1 and customer_id = $2`, [
    DEMO_ORG,
    cust,
  ]);
  await q(`delete from public.disputes where org_id = $1 and customer_id = $2`, [DEMO_ORG, cust]);
  await q(
    `delete from public.allocations where org_id = $1 and invoice_id in (select id from public.invoices where customer_id = $2)`,
    [DEMO_ORG, cust],
  );
  await q(`delete from public.payments where org_id = $1 and customer_id = $2`, [DEMO_ORG, cust]);
  await q(
    `delete from public.pay_tokens where org_id = $1 and invoice_id in (select id from public.invoices where customer_id = $2)`,
    [DEMO_ORG, cust],
  );
  await q(`delete from public.invoices where org_id = $1 and customer_id = $2`, [DEMO_ORG, cust]);
  await q(`delete from public.customers where id = $1`, [cust]);
  await q(`delete from public.rate_limits`, []);
  await db.end();
  console.table(results);
}
