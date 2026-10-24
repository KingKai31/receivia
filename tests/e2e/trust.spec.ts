import { expect, test } from '@playwright/test';

// The public trust page runs its checks in the browser; every one must pass, in every language.
for (const lang of ['en', 'hi', 'mr']) {
  test(`trust page: all checks pass signed out (${lang})`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript((l) => localStorage.setItem('receivia.lang', l), lang);
    await page.goto('/trust');
    const status = page.locator('[role=status]').first();
    await expect(status).toContainText(/\d/, { timeout: 60_000 });
    await expect(page.getByText(/Some did not|कुछ विफल|काही अयशस्वी/)).toHaveCount(0);
    await expect(status).toContainText(
      /All \d+ checks passed|सभी \d+ जाँचें सफल|सर्व \d+ तपासण्या यशस्वी/,
      {
        timeout: 60_000,
      },
    );
    await expect(page.getByText(/^(FAIL|विफल|अयशस्वी)$/)).toHaveCount(0);
    expect(await page.locator('li', { hasText: /Razorpay/ }).count()).toBeGreaterThan(0);
  });
}
