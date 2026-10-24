import { expect, test } from '@playwright/test';
import { openDemo } from './helpers';

// Needs a production build served over http (npm run build && npm run preview, or the live site):
// the service worker is not registered by the dev server.
test.skip(!process.env.LIVE_URL && !process.env.PWA_URL, 'set LIVE_URL or PWA_URL');
test.use({ baseURL: process.env.LIVE_URL ?? process.env.PWA_URL });

test('manifest is installable and Today stays readable offline with "last updated"', async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  await openDemo(page);
  const manifest = await page.evaluate(async () => {
    const href = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href;
    return href
      ? ((await (await fetch(href)).json()) as {
          name: string;
          display: string;
          icons: { sizes: string }[];
        })
      : null;
  });
  expect(manifest?.display).toBe('standalone');
  expect(manifest?.icons.map((i) => i.sizes)).toEqual(
    expect.arrayContaining(['192x192', '512x512']),
  );

  await expect(page.getByText(/Last updated/)).toBeVisible({ timeout: 60_000 });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(2000);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText(/You are offline/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/last updated/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await page.goto('/forecast');
  await expect(page.getByText(/You are offline/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Forecast', exact: true })).toBeVisible();
  await context.setOffline(false);
});
