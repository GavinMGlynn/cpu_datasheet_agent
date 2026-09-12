import path from 'node:path';

import { test as setup, type Page } from '@playwright/test';

import { E2E_ADMIN, E2E_PASSWORD, E2E_VIEWER } from './seed.js';

/**
 * Signs in once, and keeps the session for every test that follows.
 *
 * A password hash is deliberately expensive — that is the whole point of
 * scrypt — so paying for one per test is paying for the same thing forty
 * times. The tests that are about signing in start from nothing and do it
 * themselves; everything else starts already inside.
 */

export const ADMIN_STATE = path.join('test', 'e2e', '.data', 'admin-state.json');
export const VIEWER_STATE = path.join('test', 'e2e', '.data', 'viewer-state.json');

async function signInAndSave(page: Page, username: string, file: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('navigation', { name: 'Parts' }).waitFor();
  await page.context().storageState({ path: file });
}

setup('sign in as the admin', async ({ page }) => {
  await signInAndSave(page, E2E_ADMIN, ADMIN_STATE);
});

setup('sign in as the viewer', async ({ page }) => {
  await signInAndSave(page, E2E_VIEWER, VIEWER_STATE);
});
