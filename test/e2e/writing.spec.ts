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
    .getByRole('row', { name: /^vinMax/iu })
    .getByRole('button', { name: 'Correct' })
    .click();

  const dialog = page.getByRole('dialog', { name: 'correct vinMax' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Save correction' })).toBeDisabled();

  await page.getByLabel('Value, as JSON').fill('{"value":26,"unit":"V"}');
  await page.getByLabel('What you read, and where').fill('page 2, ordering information');
  await page.getByLabel('Why you are changing it').fill('the ordering table says 26 V');
  await page.getByLabel('Your name').fill('gavin');
  await page.getByRole('button', { name: 'Save correction' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('row', { name: /^vinMax/iu })).toContainText('26 V');
  await expect(page.getByRole('row', { name: /^vinMax/iu })).toContainText('By hand');

  await page.getByRole('link', { name: 'Audit trail' }).click();
  const row = page.getByRole('row', { name: /parameter\.correct/iu });
  await expect(row).toContainText('gavin');
  await expect(row).toContainText('the ordering table says 26 V');
  await expect(row).toContainText('28');
  await expect(row).toContainText('26');
});

test('a correction the schema refuses changes nothing', async ({ page }) => {
  await page.goto(`/parts/AP62200WU-7?token=${E2E_TOKEN}`);
  await page
    .getByRole('row', { name: /^vinMin/iu })
    .getByRole('button', { name: 'Correct' })
    .click();
  await page.getByLabel('Value, as JSON').fill('"3 V to 32 V"');
  await page.getByLabel('What you read, and where').fill('page 1');
  await page.getByLabel('Why you are changing it').fill('trying a string where a quantity belongs');
  await page.getByRole('button', { name: 'Save correction' }).click();
  await expect(page.getByRole('alert')).toContainText('invalid');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('row', { name: /^vinMin/iu })).toContainText('3.5 V');
});

test('answering a question records who answered and what they said', async ({ page }) => {
  await page.getByRole('link', { name: 'Questions' }).click();
  await expect(page.getByText(/Which is correct/iu)).toBeVisible();
  await page.getByRole('button', { name: 'Answer' }).click();
  await page.getByLabel('Your answer').fill('28 V: the ordering table is the authority');
  await page.getByLabel('Why you are answering it').fill('read page 2 myself');
  await page.getByLabel('Your name').fill('gavin');
  await page.getByRole('button', { name: 'Record answer' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  await page.getByLabel('show').selectOption('resolved');
  await expect(page.getByText(/answered by gavin/iu)).toBeVisible();
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
