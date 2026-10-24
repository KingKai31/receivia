import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openDemo } from './helpers';

// axe on every main route in all three languages; serious and critical issues fail the test.
const ROUTES = [
  '/',
  '/invoices',
  '/invoices/new',
  '/customers',
  '/customers/new',
  '/import',
  '/collect',
  '/inbox',
  '/payments',
  '/payments/tds',
  '/forecast',
  '/expenses',
  '/settings',
  '/privacy',
  '/trust',
];

for (const lang of ['en', 'hi', 'mr']) {
  test(`axe: no serious or critical issues (${lang})`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.addInitScript((l) => localStorage.setItem('receivia.lang', l), lang);
    await openDemo(page);
    const failures: string[] = [];
    for (const route of ROUTES) {
      await page.goto(route);
      await page.waitForTimeout(1500);
      const res = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      for (const v of res.violations.filter(
        (x) => x.impact === 'serious' || x.impact === 'critical',
      )) {
        failures.push(
          `${route} ${v.id} (${v.impact}): ${v.nodes.length} nodes, e.g. ${v.nodes[0]?.target.join(' ')}`,
        );
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });
}
