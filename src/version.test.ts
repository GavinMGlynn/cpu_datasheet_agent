import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ValidationError } from './core/validation-error.js';
import { VERSION, versionIn } from './version.js';

async function manifest(contents: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'version-'));
  const file = path.join(dir, 'package.json');
  await writeFile(file, contents, 'utf8');
  return file;
}

describe('versionIn', () => {
  it('reads the version out of a manifest', async () => {
    const file = await manifest('{"name": "example", "version": "2.3.4-rc1"}');

    expect(versionIn(file)).toBe('2.3.4-rc1');

    await rm(path.dirname(file), { recursive: true, force: true });
  });

  it('refuses a manifest with no version rather than inventing one', async () => {
    const file = await manifest('{"name": "example"}');

    expect(() => versionIn(file)).toThrow(ValidationError);

    await rm(path.dirname(file), { recursive: true, force: true });
  });
});

describe('VERSION', () => {
  it('is this package’s own version', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u);
  });
});
