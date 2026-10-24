// Screenshots of signed-in screens. Usage: node scripts/shot.mjs <base> <outDir> <width> <light|dark> <paths...>
// A path of PAYLINK resolves to a fresh /pay/<token> for the first open demo invoice.
import fs from 'node:fs';
import { chromium } from '@playwright/test';

for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
}
const [, , base, out, w = '360', scheme = 'light', ...paths] = process.argv;
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
const ctx = await browser.newContext({
  viewport: { width: +w, height: +w < 600 ? 780 : 900 },
  colorScheme: scheme,
  reducedMotion: process.env.RM ? 'reduce' : 'no-preference',
});
const page = await ctx.newPage();
const errs = [];
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(base + '/sign-in');
await page.getByRole('button', { name: /live demo|लाइव/i }).click();
await page.getByRole('heading', { name: /^(Today|आज)$/ }).waitFor({ timeout: 60000 });

async function payPath() {
  const { VITE_SUPABASE_URL: U, VITE_SUPABASE_ANON_KEY: K } = process.env;
  return page.evaluate(
    async ({ U, K }) => {
      const key = Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k));
      const jwt = JSON.parse(localStorage[key]).access_token;
      const h = { apikey: K, authorization: `Bearer ${jwt}`, 'content-type': 'application/json' };
      const inv = await fetch(
        `${U}/rest/v1/invoices?select=id&status=in.(issued,partially_paid)&order=due_date.asc&limit=1`,
        { headers: h },
      ).then((r) => r.json());
      const r = await fetch(`${U}/functions/v1/create-pay-link`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ invoice_id: inv[0].id }),
      }).then((r) => r.json());
      return new URL(r.url).pathname;
    },
    { U, K },
  );
}

for (let p of paths.length ? paths : ['/']) {
  if (p === 'AGENT') {
    // The agent call is stubbed so the screenshot has no side effects (no email, no writes).
    await page.route('**/functions/v1/agent-run', async (r) => {
      await new Promise((res) => setTimeout(res, 9000));
      await r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto(base + '/collect');
    await page.getByRole('button', { name: /run agent now/i }).click();
    await page.waitForTimeout(3800);
    await page.screenshot({ path: `${out}/collect-agent-running-${w}-${scheme}.png` });
    console.log('collect-agent-running');
    continue;
  }
  if (p === 'INVOICE') {
    p = await page.evaluate(
      async ({ U, K }) => {
        const key = Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k));
        const jwt = JSON.parse(localStorage[key]).access_token;
        const inv = await fetch(
          `${U}/rest/v1/invoices?select=id&status=in.(issued,partially_paid)&order=due_date.asc&limit=1`,
          {
            headers: { apikey: K, authorization: `Bearer ${jwt}` },
          },
        ).then((r) => r.json());
        return '/invoices/' + inv[0].id;
      },
      { U: process.env.VITE_SUPABASE_URL, K: process.env.VITE_SUPABASE_ANON_KEY },
    );
  }
  if (p === 'PAYLINK') p = await payPath();
  await page.goto(base + p);
  await page.waitForTimeout(2500);
  const name =
    (p === '/'
      ? 'today'
      : p
          .replace(/\/pay\/.*/, '/pay')
          .replace(/\W+/g, '-')
          .replace(/^-|-$/g, '')) + `-${w}-${scheme}`;
  await page.evaluate(() =>
    document.querySelectorAll('.rv,.words').forEach((e) => e.classList.add('in')),
  );
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(
    name,
    'hscroll',
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
  );
}
console.log('errors', errs.slice(0, 5));
await browser.close();
