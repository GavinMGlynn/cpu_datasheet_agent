import { expect, test } from '@playwright/test';

import { E2E_TOKEN } from './seed.js';

/**
 * What the pages look like.
 *
 * The baselines belong to one machine: they are taken on the Rocky Linux 10
 * runner and compared there, because fonts and rasterisation differ enough
 * between machines to fail for reasons that have nothing to do with the page
 * (D71). A local run writes its own under `local/`, which is not committed.
 */

const PAGES: readonly { readonly path: string; readonly name: string }[] = [
  { path: '/', name: 'Overview' },
  { path: '/parts', name: 'Catalogue' },
  { path: '/parts/TPS54331DR', name: 'part' },
  { path: '/parameters', name: 'Parameters' },
  { path: '/runs', name: 'Runs' },
  { path: '/costs', name: 'Cost' },
  { path: '/tools', name: 'Tools' },
  { path: '/ledger', name: 'Ledger' },
  { path: '/control', name: 'control' },
  { path: '/health', name: 'Health' },
];

test.beforeEach(async ({ page }) => {
  await page.goto(`/?token=${E2E_TOKEN}`);
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
