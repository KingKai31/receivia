import { expect, type Page } from '@playwright/test';

/** Signs in through the "Open live demo" button. */
export async function openDemo(page: Page) {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: /live demo|लाइव/i }).click();
  await expect(page.getByRole('heading', { name: /^(Today|आज)$/ })).toBeVisible({
    timeout: 60_000,
  });
}
