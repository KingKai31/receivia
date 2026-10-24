// Lists elements wider than the viewport on a signed-in page: node scripts/overflow.mjs <base> <path>
import { chromium } from '@playwright/test';
const [, , base, path] = process.argv;
const b = await chromium.launch({ channel: process.env.PW_CHANNEL });
const page = await (await b.newContext({ viewport: { width: 360, height: 780 } })).newPage();
await page.goto(base + '/sign-in');
await page.getByRole('button', { name: /live demo/i }).click();
await page.getByRole('heading', { name: /^Today$/ }).waitFor({ timeout: 60000 });
await page.goto(base + path);
await page.waitForTimeout(2500);
console.log(
  await page.evaluate(() =>
    [...document.querySelectorAll('body *')]
      .filter((e) => e.getBoundingClientRect().right > innerWidth + 1)
      .slice(0, 6)
      .map(
        (e) => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right),
      ),
  ),
);
await b.close();
