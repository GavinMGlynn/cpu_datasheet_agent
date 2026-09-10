import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_EXTENSIONS,
  DEFAULT_IGNORE_DIRS,
  DEFAULT_RULES,
  GateError,
  collectFiles,
  formatViolations,
  isTestFile,
  runGate,
  scanFile,
} from './scan.js';

// Tokens are assembled from fragments so this test file passes the gate too.
const t = (...parts: string[]) => parts.join('');
const UNFINISHED = t('TO', 'DO');
const FIX_MARK = t('FIX', 'ME');
const SKIP = t('.', 'skip', '(');
const ONLY = t('.', 'only', '(');
const PENDING_CALL = t('.', 'todo', '(');
const TS_IGNORE = t('@ts-', 'ignore');
const TS_NOCHECK = t('@ts-', 'nocheck');
const TS_EXPECT = t('@ts-', 'expect-error');
const LINT_OFF = t('eslint-', 'disable');

let root: string;

async function write(relative: string, content: string): Promise<void> {
  const full = path.join(root, relative);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content, 'utf8');
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'gate-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('DEFAULT_RULES', () => {
  const cases: readonly (readonly [string, string, string])[] = [
    ['todo-marker', `// ${UNFINISHED}: later`, `const ${UNFINISHED}s = 1;`],
    ['fixme-marker', `/* ${FIX_MARK} */`, `${FIX_MARK}D = 2`],
    ['skipped-test', `it${SKIP}'x', () => {})`, `describe.skipIf(cond)('x', () => {})`],
    ['focused-test', `it${ONLY} 'x', () => {})`, `const onlyOne = list.only`],
    ['todo-test', `test${PENDING_CALL}'x')`, `const todoList = []`],
    ['ts-ignore', `// ${TS_IGNORE}`, `// ts-ignore-this-word`],
    ['ts-nocheck', `// ${TS_NOCHECK}`, `// nocheck`],
    ['ts-expect-error', `// ${TS_EXPECT} bad`, `// expect-error`],
    ['lint-suppression', `/* ${LINT_OFF} */`, `// eslint enabled`],
  ];

  it.each(cases)('%s matches its token and not a near miss', (name, hit, miss) => {
    const rule = DEFAULT_RULES.find((candidate) => candidate.name === name);
    expect(rule).toBeDefined();
    expect(rule?.pattern.test(hit)).toBe(true);
    expect(rule?.pattern.test(miss)).toBe(false);
  });

  it('exempts only the expect-error rule for test files', () => {
    const exempt = DEFAULT_RULES.filter((rule) => rule.exemptTestFiles).map((rule) => rule.name);
    expect(exempt).toEqual(['ts-expect-error']);
  });

  it('uses stateless patterns', () => {
    for (const rule of DEFAULT_RULES) {
      expect(rule.pattern.global).toBe(false);
      expect(rule.pattern.sticky).toBe(false);
    }
  });
});

describe('isTestFile', () => {
  it.each(['a.test.ts', 'dir/b.test.mts', 'c.test.js', 'd.test.cjs'])('accepts %s', (file) => {
    expect(isTestFile(file)).toBe(true);
  });

  it.each(['a.ts', 'test.ts', 'a.test.tsx', 'a.tests.ts', 'a.test.ts.bak'])(
    'rejects %s',
    (file) => {
      expect(isTestFile(file)).toBe(false);
    },
  );
});

describe('collectFiles', () => {
  it('lists files with matching extensions recursively, sorted, skipping ignored directories', async () => {
    await write('src/a.ts', '');
    await write('src/deep/b.mjs', '');
    await write('src/notes.md', '');
    await write('src/node_modules/x.ts', '');
    await write('src/dist/y.js', '');
    await write('src/coverage/z.cjs', '');
    await write('bin/c.cts', '');

    const files = await collectFiles(['src', 'bin'], { cwd: root });

    expect(files.map((file) => path.relative(root, file))).toEqual([
      'bin/c.cts',
      'src/a.ts',
      'src/deep/b.mjs',
    ]);
  });

  it('honours custom extensions and ignore directories', async () => {
    await write('src/a.ts', '');
    await write('src/b.py', '');
    await write('src/vendor/c.py', '');
    await write('src/node_modules/d.py', '');

    const files = await collectFiles(['src'], {
      cwd: root,
      extensions: ['.py'],
      ignoreDirs: ['vendor'],
    });

    expect(files.map((file) => path.relative(root, file))).toEqual([
      'src/b.py',
      'src/node_modules/d.py',
    ]);
  });

  it('throws GATE_ROOT_MISSING for a root that does not exist', async () => {
    await expect(collectFiles(['nope'], { cwd: root })).rejects.toMatchObject({
      code: 'GATE_ROOT_MISSING',
      details: { root: 'nope' },
    });
    await expect(collectFiles(['nope'], { cwd: root })).rejects.toBeInstanceOf(GateError);
  });

  it('throws GATE_ROOT_NOT_DIRECTORY for a root that is a file', async () => {
    await write('file.ts', '');

    await expect(collectFiles(['file.ts'], { cwd: root })).rejects.toMatchObject({
      code: 'GATE_ROOT_NOT_DIRECTORY',
      details: { root: 'file.ts' },
    });
  });

  it('exposes its defaults', () => {
    expect(DEFAULT_EXTENSIONS).toEqual(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs']);
    expect(DEFAULT_IGNORE_DIRS).toEqual(['node_modules', 'dist', 'coverage']);
  });
});

describe('scanFile', () => {
  it('reports every rule hit with a 1-based line number and trimmed text', async () => {
    await write('a.ts', ['clean', `  // ${UNFINISHED}: x  `, 'clean', `it${ONLY}'y')`].join('\n'));

    const violations = await scanFile(path.join(root, 'a.ts'), DEFAULT_RULES, root);

    expect(violations).toEqual([
      { file: 'a.ts', line: 2, rule: 'todo-marker', text: `// ${UNFINISHED}: x` },
      { file: 'a.ts', line: 4, rule: 'focused-test', text: `it${ONLY}'y')` },
    ]);
  });

  it('handles CRLF line endings', async () => {
    await write('crlf.ts', `a\r\n${FIX_MARK}\r\nb`);

    const violations = await scanFile(path.join(root, 'crlf.ts'), DEFAULT_RULES, root);

    expect(violations).toEqual([
      { file: 'crlf.ts', line: 2, rule: 'fixme-marker', text: FIX_MARK },
    ]);
  });

  it('skips exempt rules for test files but keeps the rest', async () => {
    await write('x.test.ts', [`// ${TS_EXPECT}`, `// ${TS_IGNORE}`].join('\n'));

    const violations = await scanFile(path.join(root, 'x.test.ts'), DEFAULT_RULES, root);

    expect(violations).toEqual([
      { file: 'x.test.ts', line: 2, rule: 'ts-ignore', text: `// ${TS_IGNORE}` },
    ]);
  });

  it('applies exempt rules to non-test files', async () => {
    await write('x.ts', `// ${TS_EXPECT}`);

    const violations = await scanFile(path.join(root, 'x.ts'), DEFAULT_RULES, root);

    expect(violations.map((violation) => violation.rule)).toEqual(['ts-expect-error']);
  });

  it('can report several rules on one line', async () => {
    await write('multi.ts', `${UNFINISHED} ${FIX_MARK}`);

    const violations = await scanFile(path.join(root, 'multi.ts'), DEFAULT_RULES, root);

    expect(violations.map((violation) => violation.rule)).toEqual(['todo-marker', 'fixme-marker']);
  });
});

describe('runGate', () => {
  it('scans every file under the roots and aggregates violations', async () => {
    await write('src/clean.ts', 'export const a = 1;\n');
    await write('src/bad.ts', `// ${UNFINISHED}\n`);
    await write('src/deep/worse.js', `x\ny\n/* ${LINT_OFF} */\n`);
    await write('src/node_modules/ignored.ts', `// ${UNFINISHED}\n`);
    await write('src/README.md', `${UNFINISHED}\n`);

    const result = await runGate(['src'], { cwd: root });

    expect(result.filesScanned).toBe(3);
    expect(result.violations).toEqual([
      { file: 'src/bad.ts', line: 1, rule: 'todo-marker', text: `// ${UNFINISHED}` },
      {
        file: 'src/deep/worse.js',
        line: 3,
        rule: 'lint-suppression',
        text: `/* ${LINT_OFF} */`,
      },
    ]);
  });

  it('reports no violations for a clean tree', async () => {
    await write('src/a.ts', 'export {};\n');

    await expect(runGate(['src'], { cwd: root })).resolves.toEqual({
      filesScanned: 1,
      violations: [],
    });
  });

  it('accepts custom rules', async () => {
    await write('src/a.ts', 'console.log(1)\n');

    const result = await runGate(['src'], {
      cwd: root,
      rules: [{ name: 'console', pattern: /console\./, exemptTestFiles: false }],
    });

    expect(result.violations).toEqual([
      { file: 'src/a.ts', line: 1, rule: 'console', text: 'console.log(1)' },
    ]);
  });

  it('rejects rules with the global or sticky flag before scanning', async () => {
    await write('src/a.ts', '');

    await expect(
      runGate(['src'], {
        cwd: root,
        rules: [{ name: 'g', pattern: /x/g, exemptTestFiles: false }],
      }),
    ).rejects.toMatchObject({ code: 'GATE_RULE_STATEFUL', details: { rule: 'g', flags: 'g' } });
    await expect(
      runGate(['src'], {
        cwd: root,
        rules: [{ name: 'y', pattern: /x/y, exemptTestFiles: false }],
      }),
    ).rejects.toBeInstanceOf(GateError);
  });

  it('passes on the real repository sources', async () => {
    const repoRoot = path.resolve(import.meta.dirname, '..', '..');

    const result = await runGate(['src', 'test', 'scripts', 'bin'], { cwd: repoRoot });

    expect(result.violations).toEqual([]);
    expect(result.filesScanned).toBeGreaterThan(0);
  });
});

describe('formatViolations', () => {
  it('renders one line per violation', () => {
    expect(
      formatViolations([
        { file: 'a.ts', line: 3, rule: 'todo-marker', text: 'x' },
        { file: 'b.ts', line: 10, rule: 'ts-ignore', text: 'y' },
      ]),
    ).toBe('a.ts:3: todo-marker: x\nb.ts:10: ts-ignore: y');
  });

  it('renders an empty string for no violations', () => {
    expect(formatViolations([])).toBe('');
  });
});
