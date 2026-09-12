import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests.
 *
 * Screenshot baselines are platform-specific down to the distribution: fonts
 * and rasterisation differ between this workstation and the Rocky Linux 10
 * runner, so a baseline taken in one place fails in the other for reasons
 * that have nothing to do with the page. `SNAPSHOT_PLATFORM` names the
 * directory they live in; CI sets it to `rocky10` and commits those, and a
 * local run writes to `local/`, which is not committed (D71).
 */
const platform = process.env.SNAPSHOT_PLATFORM ?? 'local';
const port = Number(process.env.CHIP_WEB_PORT ?? 5199);
const isCi = process.env.CI === 'true';

export default defineConfig({
  testDir: 'test/e2e',
  testMatch: '**/*.spec.ts',
  snapshotPathTemplate: `test/e2e/__screenshots__/${platform}/{testFileName}/{arg}{ext}`,
  outputDir: 'test/e2e/.output',
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  reporter: isCi
    ? [['list'], ['html', { outputFolder: 'test/e2e/.report', open: 'never' }]]
    : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${String(port)}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  expect: {
    // Anti-aliasing differs by a pixel or two even on one machine; a page that
    // has genuinely changed differs by far more than this.
    toHaveScreenshot: { maxDiffPixelRatio: 0.01 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
