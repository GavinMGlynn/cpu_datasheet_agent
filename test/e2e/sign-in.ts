import type { Page } from '@playwright/test';

import { E2E_ADMIN, E2E_PASSWORD } from './seed.js';

/**
 * Signing in the way a person does.
 *
 * Through the form, against the seeded accounts, because that is the only
 * way in (D75): there is no token to put in an address any more, and a test
 * that took a shortcut past the sign-in page would stop testing it.
 */
export async function signIn(page: Page, username = E2E_ADMIN): Promise<void> {
  await page.goto('/');
  const form = page.getByLabel('Username');
  const inside = page.getByRole('navigation', { name: 'Parts' });
  // Wait for the page to have decided which of the two it is before asking:
  // a slower machine renders neither for a moment, and "no sign-in form yet"
  // is not the same as "already signed in".
  await form.or(inside).first().waitFor();
  if (await form.isVisible()) {
    await form.fill(username);
    await page.getByLabel('Password').fill(E2E_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
  }
  await inside.waitFor();
}

/** The session cookie this browser holds, for a request made outside it. */
export async function sessionHeaders(page: Page): Promise<Record<string, string>> {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((one) => one.name === 'chip_csrf')?.value ?? '';
  return { 'x-chip-token': csrf };
}
