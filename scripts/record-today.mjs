// Records a ~20 second scroll of Today (signed in as the demo user) to docs/screens/today-scroll.webm.
// Usage: PW_CHANNEL=chrome node scripts/record-today.mjs https://receivia.onrender.com
import fs from 'node:fs';
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5173';
const dir = 'docs/screens/.video';
fs.rmSync(dir, { recursive: true, force: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 780 },
  recordVideo: { dir, size: { width: 390, height: 780 } },
});
const page = await ctx.newPage();
await page.goto(base + '/sign-in');
await page.getByRole('button', { name: /live demo|लाइव/i }).click();
await page.getByRole('heading', { name: /^(Today|आज)$/ }).waitFor({ timeout: 60000 });
await page.waitForTimeout(3000);
const total = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
const steps = 40;
for (let i = 1; i <= steps; i++) {
  await page.evaluate((y) => window.scrollTo({ top: y }), (total * i) / steps);
  await page.waitForTimeout(350);
}
await page.waitForTimeout(1500);
const video = page.video();
await ctx.close();
fs.copyFileSync(await video.path(), 'docs/screens/today-scroll.webm');
fs.rmSync(dir, { recursive: true, force: true });
await browser.close();
console.log('saved docs/screens/today-scroll.webm');
