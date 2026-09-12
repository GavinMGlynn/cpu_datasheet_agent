import { expect, test } from '@playwright/test';

import { E2E_TOKEN } from './seed.js';

/**
 * Changing things, in a real browser, against a real store.
 *
 * These run against the seeded temporary directory, never the live one, and
 * they check the thing the audit trail exists for: that a change is recorded
 * with who made it and why.
 */

test.beforeEach(async ({ page }) => {
  await page.goto(`/?token=${E2E_TOKEN}`);
});

test('correcting a value stores it, keeps the old one, and says who asked', async ({ page }) => {
  await page.goto(`/parts/TPS54331DR?token=${E2E_TOKEN}`);
  await page
    .getByRole('row', { name: /^vinMax/u })
    .getByRole('button', { name: 'correct' })
    .click();

  const dialog = page.getByRole('dialog', { name: 'correct vinMax' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'store the correction' })).toBeDisabled();

  await page.getByLabel('value, as JSON').fill('{"value":26,"unit":"V"}');
  await page.getByLabel('what you read, and where').fill('page 2, ordering information');
  await page.getByLabel('why you are changing it').fill('the ordering table says 26 V');
  await page.getByLabel('your name').fill('gavin');
  await page.getByRole('button', { name: 'store the correction' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('row', { name: /^vinMax/u })).toContainText('26 V');
  await expect(page.getByRole('row', { name: /^vinMax/u })).toContainText('by hand');

  await page.getByRole('link', { name: 'audit trail' }).click();
  const row = page.getByRole('row', { name: /parameter\.correct/u });
  await expect(row).toContainText('gavin');
  await expect(row).toContainText('the ordering table says 26 V');
  await expect(row).toContainText('28');
  await expect(row).toContainText('26');
});

test('a correction the schema refuses changes nothing', async ({ page }) => {
  await page.goto(`/parts/AP62200WU-7?token=${E2E_TOKEN}`);
  await page
    .getByRole('row', { name: /^vinMin/u })
    .getByRole('button', { name: 'correct' })
    .click();
  await page.getByLabel('value, as JSON').fill('"3 V to 32 V"');
  await page.getByLabel('what you read, and where').fill('page 1');
  await page.getByLabel('why you are changing it').fill('trying a string where a quantity belongs');
  await page.getByRole('button', { name: 'store the correction' }).click();
  await expect(page.getByRole('alert')).toContainText('invalid');
  await page.getByRole('button', { name: 'cancel' }).click();
  await expect(page.getByRole('row', { name: /^vinMin/u })).toContainText('3.5 V');
});

test('answering a question records who answered and what they said', async ({ page }) => {
  await page.getByRole('link', { name: 'questions' }).click();
  await expect(page.getByText(/Which is correct/u)).toBeVisible();
  await page.getByRole('button', { name: 'answer it' }).click();
  await page.getByLabel('your answer').fill('28 V: the ordering table is the authority');
  await page.getByLabel('why').fill('read page 2 myself');
  await page.getByLabel('your name').fill('gavin');
  await page.getByRole('button', { name: 'record the answer' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  await page.getByLabel('show').selectOption('resolved');
  await expect(page.getByText(/answered by gavin/u)).toBeVisible();
});

test('the site refuses to change an evaluation database', async ({ page }) => {
  // The seeded directory has no evaluation runs, so this checks the refusal
  // at the API rather than through the selector.
  const response = await page.request.post('/api/parts/TPS54331DR/status?source=nowhere', {
    headers: { 'x-chip-token': E2E_TOKEN },
    data: { actor: 'gavin', reason: 'trying it on', status: 'rejected' },
  });
  expect(response.status()).toBe(404);
});
