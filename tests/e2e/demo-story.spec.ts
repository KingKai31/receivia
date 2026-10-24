import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// The demo story on the live site, start to finish. It writes real rows (an approved reminder, a buyer claim,
// bank lines, a payment), so afterAll resets the demo org with scripts/reset-demo.mjs, which re-seeds it.
// Run: LIVE_URL=https://receivia.onrender.com PW_CHANNEL=chrome npx playwright test tests/e2e/demo-story.spec.ts
test.skip(!process.env.LIVE_URL, 'set LIVE_URL to run the demo story on the live site');
test.describe.configure({ mode: 'serial' });

let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
});

test.afterAll(async () => {
  await page.context().close();
  if (!process.env.NO_CLEANUP) {
    const r = spawnSync('node', ['scripts/reset-demo.mjs'], { encoding: 'utf8' });
    console.log(r.stdout, r.stderr);
  }
});

const BIG = { timeout: 90_000 };
const forecastText = async () =>
  (await page.locator('main').innerText()).replace(/Last updated[^\n]*\n/, '');

test('Open live demo: Today shows the shortfall', async () => {
  test.setTimeout(150_000);
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Open live demo' }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible(BIG);
  await expect(page.getByText('Cash is tight in week')).toBeVisible(BIG);
  await expect(page.getByText(/below your safety buffer/)).toBeVisible();
});

test('forecast and the gap solver show a plan', async () => {
  await page.goto('/forecast');
  await expect(page.getByRole('heading', { name: 'Forecast', exact: true })).toBeVisible(BIG);
  await expect(page.getByRole('heading', { name: /Closing the week \d+ gap/ })).toBeVisible(BIG);
  await expect(page.getByText(/free, expected to bring in/).first()).toBeVisible();
});

test('approve a Hindi reminder', async () => {
  test.setTimeout(150_000);
  await page.goto('/collect');
  await expect(page.getByRole('heading', { name: 'Agent' })).toBeVisible(BIG);
  const row = () =>
    page
      .locator('li', { hasText: 'Theta Pharma Ltd' })
      .filter({ has: page.getByRole('button', { name: 'Approve and send' }) });
  await page.waitForTimeout(6000);
  if (!(await row().count())) {
    await page.getByRole('button', { name: 'Run agent now' }).click();
    await expect(row().first()).toBeVisible(BIG);
  }
  // This customer prefers Hindi, so the message shown on the page is in Hindi.
  await expect(page.getByText(/नमस्ते/).first()).toBeVisible();
  await row().first().getByRole('button', { name: 'Approve and send' }).click();
  // Once approved the action leaves the proposed list (in test mode the email goes to the owner).
  await expect(row()).toHaveCount(0, BIG);
});

test('the pay link opens signed out and the buyer says "I have already paid"', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  // Mint a pay link for Theta Pharma's invoice with the signed-in session, as the app does when sending.
  const session = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k))!;
    return {
      token: JSON.parse(localStorage.getItem(key)!).access_token as string,
      ref: key.replace(/^sb-/, '').replace(/-auth-token$/, ''),
    };
  });
  const base = `https://${session.ref}.supabase.co`;
  const anon = /VITE_SUPABASE_ANON_KEY=(.*)/
    .exec(readFileSync('.env.production', 'utf8'))![1]!
    .trim();
  const auth = { Authorization: `Bearer ${session.token}`, apikey: anon };
  const inv = await page.request.get(
    `${base}/rest/v1/invoices?select=id&number=eq.HIS/26-27/0080`,
    {
      headers: auth,
    },
  );
  const invoiceId = ((await inv.json()) as { id: string }[])[0]!.id;
  const link = await page.request.post(`${base}/functions/v1/create-pay-link`, {
    headers: { ...auth, 'content-type': 'application/json' },
    data: { invoice_id: invoiceId },
  });
  expect(link.ok()).toBe(true);
  const url = ((await link.json()) as { url: string }).url;
  expect(url).toContain('/pay/');

  const buyer = await (
    await browser.newContext({ viewport: { width: 360, height: 800 } })
  ).newPage();
  await buyer.goto(url.replace(/^https?:\/\/[^/]+/, process.env.LIVE_URL!));
  await expect(buyer.getByText('HIS/26-27/0080')).toBeVisible(BIG);
  await expect(buyer.getByText('देय राशि')).toBeVisible(); // a Hindi page for a Hindi customer
  await buyer.getByRole('button', { name: /पहले ही भुगतान/ }).click();
  await buyer.getByLabel(/भुगतान संदर्भ/).fill('UTR-E2E-0001');
  await buyer.getByLabel(/भुगतान की तारीख/).fill('2026-10-22');
  await buyer.getByRole('button', { name: 'भेजें' }).click();
  await expect(buyer.getByText(/हम जाँच रहे हैं|धन्यवाद/).first()).toBeVisible(BIG);
  await buyer.context().close();
});

test('Inbox resolves the claim', async () => {
  await page.goto('/inbox');
  await expect(page.getByText('UTR-E2E-0001')).toBeVisible(BIG);
  await page.getByRole('button', { name: 'Accept: mark paid' }).first().click();
  await expect(page.getByText('UTR-E2E-0001')).toHaveCount(0, BIG);
});

test('import the seed bank CSV and confirm the TDS match; the forecast updates', async () => {
  test.setTimeout(180_000);
  await page.goto('/forecast');
  await expect(page.getByRole('heading', { name: 'Forecast', exact: true })).toBeVisible(BIG);
  const before = await forecastText();

  await page.goto('/payments');
  await page.setInputFiles('#bank-file', 'supabase/seed/bank-statement.csv');
  const map: [string, string][] = [
    ['Date column', 'Date'],
    ['Description column', 'Description'],
    ['Credit (money in) column', 'Credit'],
    ['Debit (money out) column', 'Debit'],
    ['Reference column', 'Reference'],
  ];
  for (const [label, header] of map) await page.getByLabel(label).selectOption(header);
  await page.getByRole('button', { name: /^Import \d+ lines$/ }).click();
  await expect(page.getByText('Short by TDS').first()).toBeVisible(BIG);
  const card = page
    .locator('section', { hasText: 'Short by TDS' })
    .filter({ has: page.getByRole('button', { name: 'Confirm' }) })
    .first();
  const tdsCards = () =>
    page
      .locator('section', { hasText: 'Short by TDS' })
      .filter({ has: page.getByRole('button', { name: 'Confirm' }) });
  const n0 = await tdsCards().count();
  await card.getByRole('button', { name: 'Confirm' }).click();
  await expect.poll(() => tdsCards().count(), BIG).toBeLessThan(n0);
  await expect(page.getByText('Recent payments')).toBeVisible();

  await page.goto('/forecast');
  await expect(page.getByRole('heading', { name: 'Forecast', exact: true })).toBeVisible(BIG);
  await expect.poll(forecastText, BIG).not.toBe(before);
});
