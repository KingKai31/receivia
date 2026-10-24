import { chromium } from '@playwright/test';
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
for (const p of paths.length ? paths : ['/']) {
  await page.goto(base + p);
  await page.waitForTimeout(3500);
  const name = (p === '/' ? 'today' : p.replace(/\W+/g, '-').replace(/^-|-$/g, '')) + `-${w}-${scheme}`;
  await page.evaluate(() => document.querySelectorAll('.rv,.words').forEach((e) => e.classList.add('in')));
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: false });
  console.log(name, 'hscroll', await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1));
}
console.log('errors', errs.slice(0, 5));
await browser.close();
