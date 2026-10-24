import { expect, test } from '@playwright/test';

// Smoke test of the deployed site. Needs LIVE_URL; PAY_TOKEN (a fresh pay token) for the buyer page check.
test.skip(!process.env.LIVE_URL, 'set LIVE_URL to run against the deployed site');
test.use({ viewport: { width: 360, height: 800 } });

const noOverflow = async (page: import('@playwright/test').Page) => {
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(w[0]).toBeLessThanOrEqual(w[1]!);
};

test('open live demo, Today and /forecast load at 360px with no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/sign-in');
  await page.getByRole('button', { name: /live demo/i }).click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/Cash is|safe for/i).first()).toBeVisible({ timeout: 45_000 });
  await noOverflow(page);
  await page.goto('/forecast');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/week/i).first()).toBeVisible({ timeout: 45_000 });
  await noOverflow(page);
  await page.goto('/collect');
  await expect(page.getByRole('heading', { name: 'Agent' })).toBeVisible({ timeout: 45_000 });
  await noOverflow(page);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('a /pay/:token link opens signed out', async ({ page }) => {
  test.skip(!process.env.PAY_TOKEN, 'set PAY_TOKEN');
  await page.goto(`/pay/${process.env.PAY_TOKEN}`);
  await expect(page.getByText(/INV|HIS/).first()).toBeVisible({ timeout: 45_000 });
  await expect(page).toHaveURL(/\/pay\//);
  await noOverflow(page);
});

test('the approve page rejects an invalid link without signing in', async ({ page }) => {
  await page.goto('/approve?t=bad.token');
  await expect(page.getByText(/invalid or has expired/i)).toBeVisible({ timeout: 30_000 });
});
