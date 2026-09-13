import { expect, test } from '@playwright/test';

import { signIn } from './sign-in.js';

/**
 * What the pages look like.
 *
 * The baselines belong to one font stack: they are taken inside the pinned
 * Playwright image and compared there, because fonts and rasterisation differ
 * enough between machines to fail for reasons that have nothing to do with
 * the page (D78). A local run writes its own under `local/`, not committed.
 */

// The file name is lowercase and stays put; what the page is called can
// change with the copy without orphaning a committed baseline.
const PAGES: readonly { readonly path: string; readonly name: string }[] = [
  { path: '/', name: 'overview' },
  { path: '/parts', name: 'catalogue' },
  { path: '/parts/TPS54331DR', name: 'part' },
  { path: '/parameters', name: 'parameters' },
  { path: '/runs', name: 'runs' },
  { path: '/costs', name: 'cost' },
  { path: '/tools', name: 'tools' },
  { path: '/ledger', name: 'ledger' },
  { path: '/control', name: 'control' },
  { path: '/health', name: 'health' },
];

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

for (const one of PAGES) {
  test(`${one.name} looks right`, async ({ page }) => {
    await page.goto(one.path);
    // Wait for the page to have finished loading rather than for a fixed
    // time: a screenshot of a spinner is a screenshot of nothing.
    await expect(page.getByRole('status')).toHaveCount(0);
    await expect(page).toHaveScreenshot(`${one.name}.png`, { fullPage: true });
  });
}

test('the dark theme is its own set of steps, not an inversion', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page).toHaveScreenshot('overview-dark.png', { fullPage: true });
});

test('the sidebar folds away on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto('/parts');
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page).toHaveScreenshot('catalogue-narrow.png', { fullPage: true });
});
