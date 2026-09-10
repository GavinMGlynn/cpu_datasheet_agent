import { defineConfig } from 'vitest/config';

// Live contract tests talk to real APIs through the cache. They run only via
// `npm run test:live` (which sets LIVE_TESTS=1) and never in CI.
export default defineConfig({
  test: {
    include: ['test/live/**/*.test.ts'],
    passWithNoTests: true,
    coverage: { enabled: false },
  },
});
