import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests.
 *
 * Screenshot baselines are platform-specific down to the font stack: fonts
 * and rasterisation differ between this workstation and the machine that took
 * the baseline, so one taken in one place fails in the other for reasons that
 * have nothing to do with the page. `SNAPSHOT_PLATFORM` names the directory
 * they live in. CI sets it to `playwright-noble` and commits those, taken
 * inside the pinned `mcr.microsoft.com/playwright` image, which anyone can
 * run; a local run writes to `local/`, which is not committed (D78).
 */
const platform = process.env.SNAPSHOT_PLATFORM ?? 'local';
const port = Number(process.env.CHIP_WEB_PORT ?? 5199);
const isCi = process.env.CI === 'true';

export default defineConfig({
  testDir: 'test/e2e',
  testMatch: ['**/*.setup.ts', '**/*.spec.ts'],
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
  projects: [
    // Signing in costs a scrypt verify by design; this pays for it once and
    // hands the session to everything else (the specs about signing in start
    // from nothing of their own accord).
    { name: 'sign in', testMatch: /.*\.setup\.ts/u, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'chromium',
      testMatch: /.*\.spec\.ts/u,
      dependencies: ['sign in'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'test/e2e/.data/admin-state.json',
      },
    },
  ],
  /*
   * A real server over the seeded directory, built from source each run. The
   * seeding is the first half of this command on purpose: the server must not
   * open a database that is about to be deleted and rebuilt underneath it.
   * The accounts are seeded with the data, so a test signs in through the
   * form the way a person does (D75).
   *
   * Never reused. Something else already listening on this port answers
   * `/api/ping` just as well — including a `npm run web` over the real data
   * directory — and the suite would then be reading the live store and
   * reporting whatever it found there (D70). Refusing to reuse turns that
   * into a port-in-use failure, which is the loud version of the same fact.
   */
  webServer: {
    command:
      `npx tsx test/e2e/prepare.ts && ` +
      `npx tsx bin/chip-web.ts --port ${String(port)} --data test/e2e/.data --ui dist/ui`,
    url: `http://127.0.0.1:${String(port)}/api/ping`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { LOG_LEVEL: 'error' },
  },
});
