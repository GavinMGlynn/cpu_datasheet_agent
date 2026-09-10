import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { ChipAgentError } from '../errors.js';

export interface GateRule {
  readonly name: string;
  /** Tested per line. Must not carry the global or sticky flag. */
  readonly pattern: RegExp;
  /** When true, the rule is skipped for test files, where the token is the proof the rule asks for. */
  readonly exemptTestFiles: boolean;
}

export interface GateViolation {
  /** Path relative to `cwd`. */
  readonly file: string;
  /** 1-based line number. */
  readonly line: number;
  readonly rule: string;
  /** The offending line, trimmed. */
  readonly text: string;
}

export interface GateOptions {
  readonly cwd: string;
  readonly rules?: readonly GateRule[];
  readonly extensions?: readonly string[];
  readonly ignoreDirs?: readonly string[];
}

export interface GateResult {
  readonly filesScanned: number;
  readonly violations: readonly GateViolation[];
}

export class GateError extends ChipAgentError {}

// Rule tokens are assembled from fragments so this file never contains the
// tokens it forbids and passes its own scan.
const token = (...parts: readonly string[]): string => parts.join('');

export const DEFAULT_RULES: readonly GateRule[] = Object.freeze([
  {
    name: 'todo-marker',
    pattern: new RegExp(token('\\b', 'TO', 'DO', '\\b')),
    exemptTestFiles: false,
  },
  {
    name: 'fixme-marker',
    pattern: new RegExp(token('\\b', 'FIX', 'ME', '\\b')),
    exemptTestFiles: false,
  },
  {
    name: 'skipped-test',
    pattern: new RegExp(token('\\.', 'skip', '\\s*\\(')),
    exemptTestFiles: false,
  },
  {
    name: 'focused-test',
    pattern: new RegExp(token('\\.', 'only', '\\s*\\(')),
    exemptTestFiles: false,
  },
  {
    name: 'todo-test',
    pattern: new RegExp(token('\\.', 'todo', '\\s*\\(')),
    exemptTestFiles: false,
  },
  { name: 'ts-ignore', pattern: new RegExp(token('@ts-', 'ignore')), exemptTestFiles: false },
  { name: 'ts-nocheck', pattern: new RegExp(token('@ts-', 'nocheck')), exemptTestFiles: false },
  {
    name: 'ts-expect-error',
    pattern: new RegExp(token('@ts-', 'expect-error')),
    exemptTestFiles: true,
  },
  {
    name: 'lint-suppression',
    pattern: new RegExp(token('eslint-', 'disable')),
    exemptTestFiles: false,
  },
]);

export const DEFAULT_EXTENSIONS: readonly string[] = Object.freeze([
  '.ts',
  '.mts',
  '.cts',
  '.js',
  '.mjs',
  '.cjs',
]);

export const DEFAULT_IGNORE_DIRS: readonly string[] = Object.freeze([
  'node_modules',
  'dist',
  'coverage',
]);

const TEST_FILE = /\.test\.[cm]?[jt]s$/;

export function isTestFile(file: string): boolean {
  return TEST_FILE.test(file);
}

/**
 * Lists files under each root, recursively, filtered by extension and
 * skipping ignored directory names. Roots are resolved against `cwd`. Throws
 * `GateError` (`GATE_ROOT_MISSING`, `GATE_ROOT_NOT_DIRECTORY`) rather than
 * silently scanning nothing.
 */
export async function collectFiles(
  roots: readonly string[],
  options: GateOptions,
): Promise<readonly string[]> {
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS;
  const ignoreDirs = options.ignoreDirs ?? DEFAULT_IGNORE_DIRS;
  const files: string[] = [];
  for (const root of roots) {
    const absolute = path.resolve(options.cwd, root);
    let info;
    try {
      info = await stat(absolute);
    } catch (error) {
      throw new GateError('GATE_ROOT_MISSING', `gate root does not exist: ${root}`, {
        cause: error,
        details: { root },
      });
    }
    if (!info.isDirectory()) {
      throw new GateError('GATE_ROOT_NOT_DIRECTORY', `gate root is not a directory: ${root}`, {
        details: { root },
      });
    }
    await walk(absolute, files, extensions, ignoreDirs);
  }
  return files.sort();
}

async function walk(
  dir: string,
  out: string[],
  extensions: readonly string[],
  ignoreDirs: readonly string[],
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!ignoreDirs.includes(entry.name)) {
        await walk(full, out, extensions, ignoreDirs);
      }
    } else if (extensions.includes(path.extname(entry.name))) {
      out.push(full);
    }
  }
}

/** Scans one file. Rules marked `exemptTestFiles` are skipped for test files. */
export async function scanFile(
  file: string,
  rules: readonly GateRule[],
  cwd: string,
): Promise<readonly GateViolation[]> {
  const content = await readFile(file, 'utf8');
  const applicable = isTestFile(file) ? rules.filter((rule) => !rule.exemptTestFiles) : rules;
  const relative = path.relative(cwd, file);
  const violations: GateViolation[] = [];
  content.split(/\r?\n/).forEach((text, index) => {
    for (const rule of applicable) {
      if (rule.pattern.test(text)) {
        violations.push({ file: relative, line: index + 1, rule: rule.name, text: text.trim() });
      }
    }
  });
  return violations;
}

function assertStatelessRules(rules: readonly GateRule[]): void {
  for (const rule of rules) {
    if (rule.pattern.global || rule.pattern.sticky) {
      throw new GateError(
        'GATE_RULE_STATEFUL',
        `gate rule "${rule.name}" must not use the global or sticky flag`,
        { details: { rule: rule.name, flags: rule.pattern.flags } },
      );
    }
  }
}

/** Runs every rule over every file under the roots. */
export async function runGate(roots: readonly string[], options: GateOptions): Promise<GateResult> {
  const rules = options.rules ?? DEFAULT_RULES;
  assertStatelessRules(rules);
  const files = await collectFiles(roots, options);
  const perFile = await Promise.all(files.map((file) => scanFile(file, rules, options.cwd)));
  return { filesScanned: files.length, violations: perFile.flat() };
}

/** One line per violation: `file:line: rule: text`. */
export function formatViolations(violations: readonly GateViolation[]): string {
  return violations
    .map(
      (violation) =>
        `${violation.file}:${String(violation.line)}: ${violation.rule}: ${violation.text}`,
    )
    .join('\n');
}
