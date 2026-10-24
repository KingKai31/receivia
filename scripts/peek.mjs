import { chromium } from '@playwright/test';
const base = process.env.BASE ?? 'https://receivia.onrender.com';
const b = await chromium.launch({ channel: 'chrome' });
const p = await (await b.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
await p.goto(base + '/sign-in');
await p.getByRole('button', { name: 'Open live demo' }).click();
await p.waitForURL((u) => !u.pathname.includes('sign-in'), { timeout: 60000 });
await p.goto(base + (process.env.ROUTE ?? '/collect'));
await p.waitForTimeout(4000);
if (process.env.RUN) { await p.getByRole('button', { name: 'Run agent now' }).click(); await p.waitForTimeout(15000); }
console.log((await p.locator('main').innerText()).slice(0, Number(process.env.N ?? 3500)));
await b.close();
