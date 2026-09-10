import { defineConfig } from 'vitest/config';

// Coverage is measured on src/ only. bin/ and scripts/ hold entry-point shims
// of a few lines that import from src/ and call one function; they carry no
// logic of their own. Any exclusion added here needs a justification comment
// and a row in docs/PROJECT_PLAN.md section 3.
export default defineConfig({
  test: {
    // Persist module transforms between runs (node_modules/.vitest-cache).
    // Set explicitly: Vitest prints a performance hint when it is not, and the
    // project runs with zero warnings (docs/PROJECT_PLAN.md D20).
    fsModuleCache: true,
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['test/live/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
      reporter: ['text', 'lcov', 'json-summary'],
      thresholds: {
        perFile: true,
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
