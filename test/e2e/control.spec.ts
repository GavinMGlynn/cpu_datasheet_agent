import { expect, test } from '@playwright/test';

import { sessionHeaders, signIn } from './sign-in.js';

/**
 * Run control, without starting a run.
 *
 * Nothing here launches anything: a browser test that spends four dollars on
 * model calls is a test nobody runs twice. What is checked is the gate — the
 * estimate in front of you, the confirmation, and the refusals.
 */

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await page.goto('/control');
});

test('will not start until it has parts and a reason', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Start run' })).toBeDisabled();
  await page.getByLabel('Parts, separated by commas').fill('TPS54331DR');
  await expect(page.getByRole('button', { name: 'Start run' })).toBeDisabled();
  await page.getByLabel('Why you are running this').fill('checking the gate');
  await expect(page.getByRole('button', { name: 'Start run' })).toBeEnabled();
});

test('says what it would cost, and what that rests on', async ({ page }) => {
  await page.getByLabel('Parts, separated by commas').fill('TPS54331DR');
  await expect(page.getByText(/1 parts would cost about/iu)).toBeVisible();
  await expect(page.getByText(/from 1 extract run\(s\) already recorded/iu)).toBeVisible();
});

test('asks before it spends, and takes no for an answer', async ({ page }) => {
  await page.getByLabel('Parts, separated by commas').fill('TPS54331DR');
  await page.getByLabel('Why you are running this').fill('checking the gate');
  await page.getByRole('button', { name: 'Start run' }).click();

  const dialog = page.getByRole('dialog', { name: 'This will spend money' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Extracting 1 part');
  await expect(dialog).toContainText('It stops at');
  await expect(dialog).toContainText('It may not spend at the distributors');

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('nothing has been started from this browser')).toBeVisible();
});

test('the server refuses a launch that was never confirmed', async ({ page }) => {
  const response = await page.request.post('/api/launches', {
    headers: await sessionHeaders(page),
    data: {
      kind: 'extract',
      mpns: ['TPS54331DR'],
      actor: 'gavin',
      reason: 'trying it on',
      ceilingUsd: 10,
    },
  });
  expect(response.status()).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
});

test('the server refuses a launch carrying only a cookie', async ({ page }) => {
  const response = await page.request.post('/api/launches', {
    data: {
      kind: 'extract',
      mpns: ['TPS54331DR'],
      actor: 'gavin',
      reason: 'trying it on',
      ceilingUsd: 10,
      confirmed: true,
    },
  });
  expect(response.status()).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: 'WEB_TOKEN_HEADER_REQUIRED' } });
});
