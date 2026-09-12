import { expect, test } from '@playwright/test';

import { E2E_TOKEN } from './seed.js';

/**
 * Reading the site in a real browser.
 *
 * Every test signs in the way a person does: open the address the server
 * printed, which trades the token for a cookie.
 */

test.beforeEach(async ({ page }) => {
  await page.goto(`/?token=${E2E_TOKEN}`);
});

test('the overview leads with what is stored and what it cost', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'overview' })).toBeVisible();
  await expect(page.getByText('parts', { exact: true }).first()).toBeVisible();
  // Two parts seeded, $3.86 spent across the two runs.
  await expect(page.getByText('$3.86')).toBeVisible();
  await expect(page.getByRole('heading', { name: /what it has cost/u })).toBeVisible();
});

test('the catalogue lists the parts and filters them', async ({ page }) => {
  await page.getByRole('link', { name: 'catalogue' }).click();
  await expect(page).toHaveURL(/\/parts$/u);
  await expect(page.getByRole('link', { name: 'TPS54331DR' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'AP62200WU-7' })).toBeVisible();

  await page.getByLabel('search').fill('AP62');
  await expect(page.getByRole('link', { name: 'TPS54331DR' })).toBeHidden();
  await expect(page.getByRole('link', { name: 'AP62200WU-7' })).toBeVisible();
});

test('a part shows its parameters, their provenance and their verdicts', async ({ page }) => {
  await page.goto(`/parts/TPS54331DR?token=${E2E_TOKEN}`);
  await expect(page.getByRole('heading', { name: 'TPS54331DR' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'vinMax' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '28 V' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'page 4' }).first()).toBeVisible();
});

test('a page number opens the page it cites', async ({ page }) => {
  await page.goto(`/parts/TPS54331DR?token=${E2E_TOKEN}`);
  await page.getByRole('button', { name: 'page 4' }).first().click();
  const image = page.getByRole('img', { name: /page 4 of the datasheet/u });
  await expect(image).toBeVisible();
  // The image has to have actually loaded: a broken src would still be visible.
  // A broken image is still "visible", so the test asks the browser whether
  // any pixels arrived.
  const width = async (): Promise<number> => {
    const measured: unknown = await image.evaluate((node) =>
      node instanceof HTMLImageElement ? node.naturalWidth : 0,
    );
    return typeof measured === 'number' ? measured : 0;
  };
  await expect.poll(width).toBeGreaterThan(100);
});

test('the parameter grid says what the pipeline reliably finds', async ({ page }) => {
  await page.getByRole('link', { name: 'parameters' }).click();
  await expect(page.getByRole('img', { name: 'parameters by parts' })).toBeVisible();
  await expect(page.getByText('the weakest three:')).toBeVisible();
});

test('the runs page lists what the agent did, and one run opens its calls', async ({ page }) => {
  await page.getByRole('link', { name: 'runs' }).click();
  await expect(page.getByText('2 runs')).toBeVisible();
  await page.getByRole('link', { name: 'TPS54331DR' }).click();
  await expect(page.getByRole('heading', { name: /^run /u })).toBeVisible();
  await page.getByRole('button', { name: 'fetch_offers' }).click();
  await expect(page.getByLabel('what went in')).toBeVisible();
});

test('the ledger is searchable', async ({ page }) => {
  await page.getByRole('link', { name: 'ledger' }).click();
  await expect(page.getByText('3 calls match')).toBeVisible();
  await page.getByLabel('only the ones that failed').check();
  await expect(page.getByText('1 calls match')).toBeVisible();
  await expect(page.getByText('CACHE_MISS')).toBeVisible();
});

test('the cost page breaks spending down without a second axis', async ({ page }) => {
  await page.getByRole('link', { name: 'cost' }).click();
  await expect(page.getByRole('heading', { name: 'spent, and spent in total' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /spend by model/u })).toBeVisible();
});

test('every chart offers the numbers behind it', async ({ page }) => {
  await page.getByRole('link', { name: 'tools' }).click();
  const toggle = page.getByRole('button', { name: 'show the numbers' }).first();
  await toggle.click();
  await expect(page.getByRole('button', { name: 'show the chart' }).first()).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'how much' })).toBeVisible();
});

test('health reports the tools and never a credential', async ({ page }) => {
  await page.getByRole('link', { name: 'health' }).click();
  await expect(page.getByText('installed')).toBeVisible();
  await expect(page.getByText('what this system does not do')).toBeVisible();
  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(/sk-ant|client_secret/u);
});

test('a deep link reloads into the same page', async ({ page }) => {
  await page.goto(`/runs?token=${E2E_TOKEN}`);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'runs' })).toBeVisible();
});

test('an address that is not a page says so rather than blanking', async ({ page }) => {
  await page.goto(`/nonsense?token=${E2E_TOKEN}`);
  await expect(page.getByText('there is no page at')).toBeVisible();
});
