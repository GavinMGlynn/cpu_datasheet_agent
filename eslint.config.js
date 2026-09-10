// ESLint flat config. Type-aware rules use the project service, so every file
// linted must be covered by tsconfig.json. This file is JavaScript and is
// ignored below so it does not need to be in the TypeScript project.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['dist/', 'coverage/', 'node_modules/', 'data/', 'ext/', 'eslint.config.js']),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-console': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { ignoreRestSiblings: true, argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
    },
  },
  {
    // Entry-point shims are the only place that may write to the console.
    files: ['bin/**', 'scripts/**'],
    rules: { 'no-console': 'off' },
  },
  {
    // msw's request-handler types do not resolve under type-aware linting even
    // though tsc accepts them. This one module wraps msw behind plain
    // Request/Response signatures so no other file needs the exception.
    files: ['test/helpers/msw.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
  prettier,
);
