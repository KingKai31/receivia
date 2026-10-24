// Visits every main route in a language and lists visible text that still has English words.
// Usage: BASE=http://localhost:5181 LANG_CODE=hi node scripts/scan-lang.mjs
import { chromium } from '@playwright/test';

const base = process.env.BASE ?? 'http://localhost:5181';
const lang = process.env.LANG_CODE ?? 'hi';
const routes = (
  process.env.ROUTES ??
  '/,/invoices,/invoices/new,/customers,/customers/new,/import,/collect,/inbox,/payments,/payments/tds,/forecast,/expenses,/settings,/trust,/privacy'
).split(',');
const ALLOWED =
  /^(Receivia|GSTIN|GST|IGST|CGST|SGST|UPI|QR|TDS|IFSC|HSN|SAC|MSME|MSMED|PDF|CSV|Excel|Tally|WhatsApp|SMS|Udyam|IST|AIS|OTP|PAN|INR|ID|RBI|INV|CN|DN|P10|P50|P90|WAPE|HIS|xlsx|xls|csv|xml|MSMED|TReDS|Samadhaan|Razorpay|TCS|FY|SAC|AI|JSON|Resend|DPDP|API|URL|Supabase|Render|Account|Aggregator|IMS|English|ok|pg_cron)$/i;
const browser = await chromium.launch(
  process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {},
);
const ctx = await browser.newContext({ viewport: { width: 360, height: 800 } });
const page = await ctx.newPage();
await page.addInitScript((l) => localStorage.setItem('receivia.lang', l), lang);
await page.goto(`${base}/sign-in`);
await page.getByRole('button', { name: /demo|डेमो/i }).click();
await page.waitForURL((u) => !u.pathname.includes('sign-in'), { timeout: 60000 });
const seen = new Set();
async function firstHref(listRoute, re) {
  await page.goto(base + listRoute);
  await page.waitForTimeout(2500);
  return page.evaluate((src) => {
    const rx = new RegExp(src);
    return (
      [...document.querySelectorAll('a')]
        .map((a) => a.getAttribute('href'))
        .find((h) => h && rx.test(h)) ?? null
    );
  }, re);
}
if (!process.env.ROUTES) {
  const inv = await firstHref('/invoices', '^/invoices/[0-9a-f-]{36}$');
  const cus = await firstHref('/customers', '^/customers/[0-9a-f-]{36}$');
  if (inv)
    routes.push(
      inv,
      inv + '/notes/new',
      inv.replace('/invoices/', '/doc/invoice/'),
      inv.replace('/invoices/', '/doc/letter/'),
    );
  if (cus) routes.push(cus, cus.replace('/customers/', '/doc/case/'));
}
for (const r of routes) {
  await page.goto(base + r);
  await page.waitForTimeout(2500);
  const lines = await page.evaluate(() => {
    const out = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const t = w.currentNode.textContent.trim();
      const p = w.currentNode.parentElement;
      if (t && p && !['SCRIPT', 'STYLE'].includes(p.tagName)) out.push(t);
    }
    for (const el of document.querySelectorAll('[aria-label],[placeholder],[title],img[alt]')) {
      for (const a of ['aria-label', 'placeholder', 'title', 'alt']) {
        const v = el.getAttribute(a);
        if (v) out.push(v);
      }
    }
    return out;
  });
  const bad = [];
  for (const l of lines) {
    const words = l.match(/[A-Za-z][A-Za-z']{2,}/g) ?? [];
    const eng = words.filter((x) => !ALLOWED.test(x));
    if (eng.length) bad.push(l.length > 120 ? l.slice(0, 120) + '…' : l);
  }
  const uniq = [...new Set(bad)].filter((b) => !seen.has(b));
  uniq.forEach((b) => seen.add(b));
  console.log(`\n## ${r} (${uniq.length})`);
  console.log(uniq.join('\n'));
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  if (w[0] > w[1]) console.log(`!! horizontal overflow ${w[0]} > ${w[1]}`);
}
await browser.close();
