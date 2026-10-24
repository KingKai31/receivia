// Lighthouse mobile on the live site for /sign-in, /, /forecast and /pay/:token, using the demo session.
// Usage: node scripts/lighthouse-live.mjs   (needs Chrome; downloads lighthouse through npx on first run)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { chromium } from 'playwright';

const LIVE = process.env.LIVE_URL ?? 'https://receivia.onrender.com';
const anon = /VITE_SUPABASE_ANON_KEY=(.*)/
  .exec(fs.readFileSync('.env.production', 'utf8'))[1]
  .trim();
const dir = fs.mkdtempSync(`${process.env.TEMP ?? '.'}/lh-`);
const ctx = await chromium.launchPersistentContext(dir, {
  channel: 'chrome',
  headless: true,
});
const page = await ctx.newPage();
await page.goto(`${LIVE}/sign-in`);
await page.getByRole('button', { name: 'Open live demo' }).click();
await page.getByRole('heading', { name: 'Today', exact: true }).waitFor({ timeout: 90000 });
const s = await page.evaluate(() => {
  const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x));
  return {
    token: JSON.parse(localStorage.getItem(k)).access_token,
    ref: k.replace(/^sb-|-auth-token$/g, ''),
  };
});
const base = `https://${s.ref}.supabase.co`;
const h = { Authorization: `Bearer ${s.token}`, apikey: anon };
const inv = await (
  await fetch(`${base}/rest/v1/invoices?select=id&balance_paise=gt.0&order=due_date.asc&limit=1`, {
    headers: h,
  })
).json();
const link = await (
  await fetch(`${base}/functions/v1/create-pay-link`, {
    method: 'POST',
    headers: { ...h, 'content-type': 'application/json' },
    body: JSON.stringify({ invoice_id: inv[0].id }),
  })
).json();
const pay = link.url.replace(/^https?:\/\/[^/]+/, LIVE);
await ctx.close(); // flushes the session to the profile; Lighthouse then starts its own Chrome on that profile
const out = [];
for (const [name, url] of [
  ['/', `${LIVE}/`],
  ['/forecast', `${LIVE}/forecast`],
  ['/pay/:token', pay],
]) {
  const file = `${dir}/lh.json`;
  const r = spawnSync(
    `npx -y lighthouse "${url}" --chrome-flags=\"--headless=new --user-data-dir=${dir}\" --disable-storage-reset --only-categories=performance,accessibility,best-practices --output=json --output-path="${file}" --quiet`,
    { shell: true, encoding: 'utf8' },
  );
  if (!fs.existsSync(file)) console.error(r.status, r.stdout.slice(0, 500), r.stderr.slice(0, 500));
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const c = j.categories;
  out.push(
    `${name}: perf ${Math.round(c.performance.score * 100)}, a11y ${Math.round(c.accessibility.score * 100)}, best ${Math.round(c['best-practices'].score * 100)} (LCP ${j.audits['largest-contentful-paint'].displayValue}, TBT ${j.audits['total-blocking-time'].displayValue})`,
  );
}
console.log(out.join('\n'));
await ctx.close();
