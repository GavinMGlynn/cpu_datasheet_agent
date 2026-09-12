import { expect, test } from '@playwright/test';

import { E2E_ADMIN, E2E_PASSWORD, E2E_VIEWER } from './seed.js';
import { signIn } from './sign-in.js';

/**
 * The door.
 *
 * There is no token in an address any more (D75): a browser that has not
 * signed in sees the sign-in page and nothing else, and what it may do once
 * it has depends on the account (D76).
 */

test('a browser that has not signed in is shown the way in, not the data', async ({ page }) => {
  await page.goto('/parts');
  await expect(page.getByLabel('Username')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Parts' })).toBeHidden();
  // And the API says the same thing to anyone who asks it directly.
  const refused = await page.request.get('/api/parts');
  expect(refused.status()).toBe(401);
});

test('the wrong password is refused, and says nothing about which half', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Username').fill(E2E_ADMIN);
  await page.getByLabel('Password').fill('not the password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('do not match an account');
  await expect(page.getByRole('navigation', { name: 'Parts' })).toBeHidden();
});

test('signing in puts the session in an HttpOnly cookie, not in the address', async ({ page }) => {
  await signIn(page);
  expect(page.url()).not.toContain('token');
  const cookies = await page.context().cookies();
  const session = cookies.find((one) => one.name === 'chip_session');
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe('Strict');
  // The readable half is the one the page repeats in a header.
  expect(cookies.find((one) => one.name === 'chip_csrf')?.httpOnly).toBe(false);
});

test('who is signed in is on the page, and signing out ends it', async ({ page }) => {
  await signIn(page);
  await expect(page.getByText('Tester')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByLabel('Username')).toBeVisible();
  // The session is gone on the server too, not just in this tab.
  await page.goto('/parts');
  await expect(page.getByLabel('Username')).toBeVisible();
});

test('a viewer reads everything and is refused every change', async ({ page }) => {
  await signIn(page, E2E_VIEWER);
  await page.goto('/parts/TPS54331DR');
  await expect(page.getByRole('heading', { name: 'TPS54331DR' })).toBeVisible();
  // The server refuses, whatever the page offers.
  const cookies = await page.context().cookies();
  const csrf = cookies.find((one) => one.name === 'chip_csrf')?.value ?? '';
  const refused = await page.request.post('/api/parts/TPS54331DR/parameters/vinMax', {
    headers: { 'x-chip-token': csrf, 'content-type': 'application/json' },
    data: {
      value: { value: 26, unit: 'V' },
      reason: 'a viewer should not be able to do this',
      note: 'page 2',
    },
  });
  expect(refused.status()).toBe(403);
  expect(await refused.json()).toMatchObject({ error: { code: 'WEB_ROLE_INSUFFICIENT' } });
});

test('the password can be changed, and the old one stops working', async ({ page, request }) => {
  await signIn(page);
  const cookies = await page.context().cookies();
  const csrf = cookies.find((one) => one.name === 'chip_csrf')?.value ?? '';
  const changed = await page.request.post('/api/auth/password', {
    headers: { 'x-chip-token': csrf, 'content-type': 'application/json' },
    data: { current: E2E_PASSWORD, next: 'a different passphrase entirely' },
  });
  expect(changed.status()).toBe(200);

  // A browser with no session at all: the old password is refused, the new
  // one is taken.
  const old = await request.post('/api/auth/login', {
    data: { username: E2E_ADMIN, password: E2E_PASSWORD },
    failOnStatusCode: false,
  });
  expect(old.status()).toBe(401);
  const fresh = await request.post('/api/auth/login', {
    data: { username: E2E_ADMIN, password: 'a different passphrase entirely' },
    failOnStatusCode: false,
  });
  expect(fresh.status()).toBe(200);

  // Put it back, so the rest of the suite signs in with what it seeded. The
  // change issued a new session, so the token to repeat is a new one too.
  const after = await page.context().cookies();
  const rotated = after.find((one) => one.name === 'chip_csrf')?.value ?? '';
  expect(rotated).not.toBe(csrf);
  const back = await page.request.post('/api/auth/password', {
    headers: { 'x-chip-token': rotated, 'content-type': 'application/json' },
    data: { current: 'a different passphrase entirely', next: E2E_PASSWORD },
  });
  expect(back.status()).toBe(200);
});
