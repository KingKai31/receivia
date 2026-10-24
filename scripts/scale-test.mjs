// Scale and concurrency test on the live Supabase project, in a throw-away organisation.
//  1. creates a test user (its signup trigger makes an org), seeds 500 customers and 5,000 invoices
//  2. EXPLAIN ANALYZE on the screens' list queries under row-level security (execution time, scans)
//  3. autocannon: 50 concurrent users for 2 minutes: 25 on get-pay-view, 25 creating and issuing invoices
//  4. checks that issued numbers are unique and gap-free, then a stale-edit conflict check
//  5. deletes the organisation (delete_org scrubs the audit trail) and the user
// Usage: node scripts/scale-test.mjs [--seconds 120] [--keep]    Never touches the demo organisation.
import autocannon from 'autocannon';
import crypto from 'node:crypto';
import fs from 'node:fs';
import pg from 'pg';

for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
}
const URL_ = process.env.VITE_SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const SECONDS = Number(arg('seconds', 120));
const KEEP = process.argv.includes('--keep');
const EMAIL = `scale-${crypto.randomUUID().slice(0, 8)}@example.test`;
const PASSWORD = crypto.randomBytes(18).toString('base64url');
const report = { checks: [], explain: [], load: {} };
const check = (name, ok, note = '') => {
  report.checks.push({ name, result: ok ? 'pass' : 'FAIL', note });
  if (!ok) process.exitCode = 1;
};

const admin = (path, init = {}) =>
  fetch(`${URL_}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  });

const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
await db.connect();
let userId = null;
let orgId = null;
let orgName = 'Scale Test Org';
try {
  // ---- 1. setup -----------------------------------------------------------
  const created = await (
    await admin('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
    })
  ).json();
  userId = created.id;
  orgId = (await db.query('select org_id from public.memberships where user_id = $1', [userId]))
    .rows[0].org_id;
  if (orgId === '00000000-0000-4000-8000-00000000de60')
    throw new Error('refusing to use the demo org');
  await db.query('update public.orgs set name = $2 where id = $1', [orgId, orgName]);
  await db.query(
    `update public.business_profile set state_code = '27', legal_name = 'Scale Test Org' where org_id = $1`,
    [orgId],
  );

  const t0 = Date.now();
  await db.query(
    `insert into public.customers (org_id, name, state_code, phone)
     select $1, 'Scale Customer ' || lpad(g::text, 4, '0'), '27', '98' || lpad(g::text, 8, '0') from generate_series(1, 500) g`,
    [orgId],
  );
  await db.query(
    `with c as (select array_agg(id order by name) a from public.customers where org_id = $1)
     insert into public.invoices (org_id, customer_id, number, fy, status, issue_date, due_date, supplier_state_code,
       place_of_supply, taxable_paise, cgst_paise, sgst_paise, total_paise, paid_paise)
     select $1, c.a[(g % 500) + 1], 'S/' || lpad(g::text, 6, '0'), '26-27',
       case when g % 10 = 0 then 'paid' else 'issued' end,
       date '2026-04-01' + (g % 200), date '2026-04-01' + (g % 200) + 30,
       '27', '27', 100000, 9000, 9000, 118000, case when g % 10 = 0 then 118000 else 0 end
     from generate_series(1, 5000) g, c`,
    [orgId],
  );
  await db.query('analyze public.invoices');
  await db.query('analyze public.customers');
  const counts = (
    await db.query(
      `select (select count(*) from public.customers where org_id = $1)::int c, (select count(*) from public.invoices where org_id = $1)::int i`,
      [orgId],
    )
  ).rows[0];
  check(
    'seed',
    counts.c === 500 && counts.i === 5000,
    `${counts.c} customers, ${counts.i} invoices in ${Date.now() - t0} ms`,
  );

  // ---- 2. EXPLAIN under RLS ------------------------------------------------
  const queries = {
    'invoices page 1 (default list)': `select i.*, c.name from public.invoices i left join public.customers c on c.id = i.customer_id and c.org_id = i.org_id where i.org_id = $1 order by i.issue_date desc, i.created_at desc limit 25`,
    'invoices page 100': `select i.* from public.invoices i where i.org_id = $1 order by i.issue_date desc, i.created_at desc offset 2475 limit 25`,
    'invoices count': `select count(*) from public.invoices where org_id = $1`,
    'invoices overdue filter': `select * from public.invoices where org_id = $1 and status in ('issued','partially_paid') and disputed = false and due_date < date '2026-10-24' order by issue_date desc, created_at desc limit 25`,
    'invoices by customer': `select * from public.invoices where org_id = $1 and customer_id = (select id from public.customers where org_id = $1 limit 1) order by issue_date desc, created_at desc limit 25`,
    'invoice number search': `select * from public.invoices where org_id = $1 and number ilike '%S/00123%' order by issue_date desc limit 25`,
    'customers page 1': `select * from public.customers where org_id = $1 and archived_at is null order by name limit 25`,
    'customers search': `select * from public.customers where org_id = $1 and (name ilike '%0042%' or gstin ilike '%0042%' or phone ilike '%0042%') order by name limit 25`,
    'collect: overdue open invoices': `select * from public.invoices where org_id = $1 and status in ('issued','partially_paid') and due_date <= date '2026-10-24' order by due_date, id limit 1000`,
    'forecast: open invoices': `select id, number, customer_id, due_date, balance_paise, disputed from public.invoices where org_id = $1 and status in ('issued','partially_paid') and balance_paise > 0 order by id limit 1000`,
    'pay view by token hash': `select * from public.pay_tokens where token_hash = encode(extensions.digest('x', 'sha256'), 'hex')`,
  };
  async function explainAll(label) {
    const out = [];
    for (const [name, sql] of Object.entries(queries)) {
      await db.query('begin');
      await db.query('set local role authenticated');
      await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
      const r = await db.query(
        `explain (analyze, format json) ${sql}`,
        sql.includes('$1') ? [orgId] : [],
      );
      await db.query('rollback');
      const plan = r.rows[0]['QUERY PLAN'][0];
      const seq = [];
      (function walk(n) {
        if (n['Node Type'] === 'Seq Scan') seq.push(n['Relation Name']);
        (n.Plans ?? []).forEach(walk);
      })(plan.Plan);
      out.push({
        query: name,
        ms: Number(plan['Execution Time'].toFixed(2)),
        seqScan: [...new Set(seq)].join(','),
      });
    }
    report.explain.push({ label, rows: out });
    return out;
  }
  let ex = await explainAll('before');
  const slow = ex.filter((r) => r.ms >= 300);
  check(
    'queries under 300 ms (execution time, before)',
    slow.length === 0,
    ex.map((r) => `${r.query}: ${r.ms}`).join('; '),
  );

  // ---- 3. load -------------------------------------------------------------
  const tok = await (
    await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON, 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    })
  ).json();
  const jwt = tok.access_token;
  if (!jwt) throw new Error('could not sign in the test user');

  // 25 buyers with their own pay tokens
  const invs = (
    await db.query(
      `select id from public.invoices where org_id = $1 and status = 'issued' order by number limit 25`,
      [orgId],
    )
  ).rows;
  const tokens = invs.map((_, i) => `scaletoken-${crypto.randomUUID()}-${i}`);
  for (let i = 0; i < invs.length; i++) {
    await db.query(
      `insert into public.pay_tokens (org_id, invoice_id, token_hash, expires_at) values ($1, $2, encode(extensions.digest($3, 'sha256'), 'hex'), now() + interval '1 day')`,
      [orgId, invs[i].id, tokens[i]],
    );
  }
  const cust = (
    await db.query(`select id from public.customers where org_id = $1 limit 1`, [orgId])
  ).rows[0].id;
  const header = (n) => ({
    customer_id: cust,
    fy: '26-27',
    invoice_type: 'tax_invoice',
    issue_date: '2026-10-24',
    due_date: '2026-11-23',
    supplier_state_code: '27',
    place_of_supply: '27',
    taxable_paise: 100000,
    cgst_paise: 9000,
    sgst_paise: 9000,
    igst_paise: 0,
    round_off_paise: 0,
    total_paise: 118000,
    notes: `load ${n}`,
    reverse_charge: false,
    delivery_address: null,
  });
  let seq = 0;
  const dur = SECONDS;
  // One IP is limited to 60 requests a minute by design, so the edge function is probed at 50 a minute.
  const payStats = { requests: 0, ok: 0, bad: 0, lat: [] };
  const payRun = (async () => {
    const stop = Date.now() + dur * 1000;
    for (let i = 0; Date.now() < stop; i++) {
      const t = Date.now();
      const r = await fetch(`${URL_}/functions/v1/get-pay-view`, {
        method: 'POST',
        headers: { apikey: ANON, 'content-type': 'application/json' },
        body: JSON.stringify({ token: tokens[i % tokens.length] }),
      }).catch(() => null);
      payStats.requests++;
      if (r?.status === 200) payStats.ok++;
      else payStats.bad++;
      payStats.lat.push(Date.now() - t);
      await new Promise((res) => setTimeout(res, Math.max(0, 1200 - (Date.now() - t))));
    }
  })();
  const issueRun = autocannon({
    url: URL_,
    connections: 25,
    duration: dur,
    overallRate: 20,
    timeout: 30,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${jwt}`,
      'content-type': 'application/json',
      Prefer: 'return=representation',
    },
    requests: [
      {
        method: 'POST',
        path: '/rest/v1/rpc/save_invoice',
        setupRequest: (req) => ({
          ...req,
          body: JSON.stringify({
            p_org: orgId,
            p_id: null,
            p_expected: null,
            p_header: header(seq++),
            p_lines: [
              {
                description: 'Load test item',
                hsn_sac: null,
                qty: 1,
                unit: null,
                rate_paise: 100000,
                discount_paise: 0,
                gst_rate: 18,
                taxable_paise: 100000,
                cgst_paise: 9000,
                sgst_paise: 9000,
                igst_paise: 0,
                total_paise: 118000,
              },
            ],
          }),
        }),
        onResponse: (status, body, context) => {
          (report.load.saveStatus ??= {})[status] = (report.load.saveStatus[status] ?? 0) + 1;
          if (status >= 300)
            (report.load.saveErrors ??= {})[status + ' ' + body.slice(0, 200)] =
              (report.load.saveErrors?.[status + ' ' + body.slice(0, 200)] ?? 0) + 1;
          if (status >= 200 && status < 300) {
            const v = JSON.parse(body);
            context.id = v.id;
            context.updated = v.updated_at;
          }
        },
      },
      {
        method: 'POST',
        path: '/rest/v1/rpc/issue_invoice',
        onResponse: (status, body) => {
          const k = status + ' ' + body.slice(0, 160);
          (report.load.issueStatus ??= {})[k] = (report.load.issueStatus[k] ?? 0) + 1;
        },
        setupRequest: (req, context) => ({
          ...req,
          body: JSON.stringify({ p_invoice: context.id, p_expected: context.updated }),
        }),
      },
    ],
  });
  // The database side of get-pay-view (pay_view) under 24 concurrent connections, as fast as they can go.
  const lat = [];
  let dbErrors = 0;
  const stopAt = Date.now() + dur * 1000;
  const workers = Array.from({ length: 24 }, async (_, w) => {
    const c = new pg.Client({
      connectionString: process.env.TEST_DATABASE_URL.replace(':5432', ':6543'),
    }); // transaction pooler: the session pooler allows only 15 clients
    await c.connect();
    try {
      for (let i = 0; Date.now() < stopAt; i++) {
        const t = process.hrtime.bigint();
        try {
          const r = await c.query('select public.pay_view($1) v', [
            tokens[(w + i) % tokens.length],
          ]);
          if (!r.rows[0].v) dbErrors++;
        } catch {
          dbErrors++;
        }
        lat.push(Number(process.hrtime.bigint() - t) / 1e6);
      }
    } finally {
      await c.end();
    }
  });
  const [, issue] = await Promise.all([payRun, issueRun, Promise.all(workers)]);
  payStats.lat.sort((x, y) => x - y);
  const pay = {
    errors: payStats.bad,
    non2xx: 0,
    timeouts: 0,
    requests: { total: payStats.requests, average: payStats.requests / dur },
    '2xx': payStats.ok,
    latency: {
      p50: payStats.lat[Math.floor(payStats.lat.length * 0.5)],
      p97_5: payStats.lat[Math.floor(payStats.lat.length * 0.975)],
      p99: payStats.lat[payStats.lat.length - 1],
    },
  };
  lat.sort((a, b) => a - b);
  report.load.pay_view_db = {
    connections: 24,
    calls: lat.length,
    errors: dbErrors,
    p50: lat[Math.floor(lat.length * 0.5)],
    p99: lat[Math.floor(lat.length * 0.99)],
  };
  check(
    'pay_view under 24 concurrent connections: no errors',
    dbErrors === 0,
    JSON.stringify(report.load.pay_view_db),
  );
  const summarise = (r) => ({
    requests: r.requests.total,
    '2xx': r['2xx'],
    non2xx: r.non2xx,
    errors: r.errors,
    timeouts: r.timeouts,
    p50: r.latency.p50,
    p97_5: r.latency.p97_5,
    p99: r.latency.p99,
    rps: r.requests.average,
  });
  report.load.getPayView = summarise(pay);
  report.load.invoiceFlow = summarise(issue);
  check(
    'get-pay-view (edge, one IP at 54/min): no errors',
    pay.errors === 0 && pay.non2xx === 0 && pay.timeouts === 0,
    JSON.stringify(report.load.getPayView),
  );
  check(
    'invoice save+issue: no errors',
    issue.errors === 0 && issue.non2xx === 0 && issue.timeouts === 0,
    JSON.stringify(report.load.invoiceFlow),
  );

  // ---- 4. numbering --------------------------------------------------------
  const num = (
    await db.query(
      `select count(*)::int n, count(distinct number)::int d, max((regexp_replace(number, '.*/', ''))::int) mx, min((regexp_replace(number, '.*/', ''))::int) mn
       from public.invoices where org_id = $1 and number like 'INV/%'`,
      [orgId],
    )
  ).rows[0];
  check('issued numbers are unique', num.n === num.d, `${num.n} issued, ${num.d} distinct`);
  check(
    'issued numbers have no gaps',
    num.n === 0 || (num.mn === 1 && num.mx === num.n),
    `range ${num.mn}..${num.mx} for ${num.n}`,
  );

  // ---- 5. concurrent edit conflict ----------------------------------------
  const one = (
    await db.query(
      `select id, updated_at::text as updated_at from public.customers where org_id = $1 limit 1`,
      [orgId],
    )
  ).rows[0];
  const patch = (phone) =>
    fetch(
      `${URL_}/rest/v1/customers?id=eq.${one.id}&updated_at=eq.${encodeURIComponent(one.updated_at)}`,
      {
        method: 'PATCH',
        headers: {
          apikey: ANON,
          Authorization: `Bearer ${jwt}`,
          'content-type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({ phone }),
      },
    ).then((r) => r.json());
  const a = await patch('9000000001');
  const b = await patch('9000000002');
  check(
    'stale edit is refused (second writer matches no row)',
    a.length === 1 && b.length === 0,
    `first ${a.length} row, second ${b.length} rows`,
  );
} catch (e) {
  check('script', false, e.message);
} finally {
  // ---- cleanup -------------------------------------------------------------
  if (!KEEP && orgId && orgId !== '00000000-0000-4000-8000-00000000de60') {
    try {
      await db.query('begin');
      await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
      await db.query('select public.delete_org($1, $2)', [orgId, orgName]);
      await db.query('commit');
      const left = (
        await db.query('select count(*)::int n from public.invoices where org_id = $1', [orgId])
      ).rows[0].n;
      check('test org deleted', left === 0, `${left} invoices left`);
    } catch (e) {
      await db.query('rollback').catch(() => {});
      check('cleanup', false, e.message);
    }
  }
  if (!KEEP && userId) await admin(`/auth/v1/admin/users/${userId}`, { method: 'DELETE' });
  await db.end();
  console.log(JSON.stringify(report, null, 1));
}
