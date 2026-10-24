import { expect, test } from '@playwright/test';
import { openDemo } from './helpers';

// 360px wide in every language: no sideways scrolling on the main screens, and keyboard users can skip the menu.
test.use({ viewport: { width: 360, height: 800 } });

const ROUTES = [
  '/',
  '/invoices',
  '/customers',
  '/collect',
  '/inbox',
  '/payments',
  '/forecast',
  '/expenses',
  '/settings',
  '/trust',
  '/privacy',
];

for (const lang of ['en', 'hi', 'mr']) {
  test(`360px: no horizontal overflow (${lang})`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.addInitScript((l) => localStorage.setItem('receivia.lang', l), lang);
    await openDemo(page);
    for (const route of ROUTES) {
      await page.goto(route);
      await page.waitForTimeout(1200);
      const [sw, iw] = await page.evaluate(() => [
        document.documentElement.scrollWidth,
        window.innerWidth,
      ]);
      expect(sw, `${route} scrollWidth`).toBeLessThanOrEqual(iw!);
    }
  });
}

test('keyboard: the first Tab stop is the skip link and it moves focus to the content', async ({
  page,
}) => {
  await openDemo(page);
  await page.goto('/invoices');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
});

test('every form field on a main form has a visible label', async ({ page }) => {
  await openDemo(page);
  for (const route of ['/customers/new', '/invoices/new', '/settings']) {
    await page.goto(route);
    await page.waitForTimeout(1200);
    const unlabeled = await page.evaluate(() =>
      [...document.querySelectorAll('input:not([type=hidden]):not([type=file]), select, textarea')]
        .filter((el) => !(el as HTMLInputElement).labels?.length && !el.getAttribute('aria-label'))
        .map((el) => el.outerHTML.slice(0, 80)),
    );
    expect(unlabeled, route).toEqual([]);
  }
});
