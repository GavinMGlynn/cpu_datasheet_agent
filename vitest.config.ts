import { defineConfig } from 'vitest/config';

// Coverage is measured on src/ only. bin/ and scripts/ hold entry-point shims
// of a few lines that import from src/ and call one function; they carry no
// logic of their own. Any exclusion added here needs a justification comment
// and a row in docs/PROJECT_PLAN.md section 3.
export default defineConfig({
  // The browser tests render TSX. `automatic` compiles JSX to the runtime
  // import rather than to React.createElement, so no file needs React in
  // scope; the UI's own tsconfig says the same thing to the type checker.
  esbuild: { jsx: 'automatic' },
  test: {
    // Persist module transforms between runs (node_modules/.vitest-cache).
    // Set explicitly: Vitest prints a performance hint when it is not, and the
    // project runs with zero warnings (docs/PROJECT_PLAN.md D20).
    fsModuleCache: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'test/**/*.test.ts'],
    // test/e2e holds Playwright specs (`*.spec.ts`), which have their own
    // runner and their own browser; vitest must not try to run them.
    exclude: ['test/live/**', 'test/e2e/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/**/*.d.ts',
        // The browser entry point: three lines that find the root element and
        // mount the application. Covered by the browser tests, not by jsdom.
        'src/web/ui/main.tsx',
        // Turning the terminal's echo off and reading standard input to its
        // end: mechanics with no decision in them, and no way to exercise
        // them without a real TTY.
        'src/auth/terminal.ts',
      ],
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
