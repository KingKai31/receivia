import { expect, test } from '@playwright/test';
import { openDemo } from './helpers';

// Two people editing the same customer: the second save is refused with a message that says what happened.
// Runs against any deployed URL (LIVE_URL or BASE_URL). The phone number is put back afterwards.
test('a concurrent edit shows the conflict message instead of overwriting', async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  await openDemo(page);
  await page.goto('/customers');
  await page
    .getByRole('link', { name: /Alpha|Beta|Delta/ })
    .first()
    .waitFor({ timeout: 60_000 });
  const href = await page
    .locator('a[href^="/customers/"]')
    .evaluateAll((as) =>
      as
        .map((a) => a.getAttribute('href'))
        .find((h) => /^\/customers\/[0-9a-f-]{36}$/.test(h ?? '')),
    );
  expect(href).toBeTruthy();
  const editUrl = `${href}/edit`;

  const other = await context.newPage();
  await page.goto(editUrl);
  await other.goto(editUrl);
  const phoneA = page.getByLabel('Phone');
  const phoneB = other.getByLabel('Phone');
  await expect(phoneA).toBeVisible({ timeout: 60_000 });
  await expect(phoneB).toBeVisible({ timeout: 60_000 });
  const original = await phoneA.inputValue();

  await phoneA.fill('9000000001');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Customer saved.')).toBeVisible({ timeout: 30_000 });

  await phoneB.fill('9000000002');
  await other.getByRole('button', { name: 'Save' }).click();
  await expect(other.getByText(/Someone else changed this record/)).toBeVisible({
    timeout: 30_000,
  });

  // put the data back
  await page.goto(editUrl);
  await page.getByLabel('Phone').fill(original);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Customer saved.')).toBeVisible({ timeout: 30_000 });
});
