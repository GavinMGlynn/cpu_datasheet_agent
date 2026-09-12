import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { part as partFixture } from '../../../test/helpers/core-fixtures.js';
import { createRepositories, openDatabase } from '../../db/index.js';
import { writeSnapshot } from './write.js';

/**
 * Writing the snapshot is the one place the whole site is assembled for a
 * single read, so these tests care that it opens everything, writes one file,
 * and closes everything again — including when the read fails.
 */

let root: string;
let dataDir: string;

function env(): NodeJS.ProcessEnv {
  return { DATA_DIR: dataDir, LOG_LEVEL: 'error' };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'chip-snapshot-'));
  dataDir = path.join(root, 'data');
  const db = openDatabase(path.join(dataDir, 'chip.sqlite'));
  createRepositories(db).parts.upsertPart(partFixture());
  db.close();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('writeSnapshot', () => {
  it('writes one self-contained file and says how big it is', async () => {
    const file = path.join(root, 'share', 'snapshot.html');
    const written = await writeSnapshot(file, { dataDir, env: env() });
    expect(written.file).toBe(file);
    const html = await readFile(file, 'utf8');
    expect(written.bytes).toBe(Buffer.byteLength(html));
    expect(html).toContain('TPS54331DR');
    expect(html).toContain('<!doctype html>');
  });

  it('creates the directory it was asked to write into', async () => {
    const file = path.join(root, 'a', 'b', 'c', 'snapshot.html');
    await writeSnapshot(file, { dataDir, env: env() });
    await expect(stat(path.dirname(file))).resolves.toMatchObject({});
  });

  it('reads whichever database it is told to, and refuses one that is not there', async () => {
    await expect(
      writeSnapshot(path.join(root, 'snapshot.html'), { dataDir, env: env() }, { source: 'gone' }),
    ).rejects.toThrow(expect.objectContaining({ code: 'WEB_SOURCE_NOT_FOUND' }));
  });

  it('closes the store it opened, so a second snapshot succeeds too', async () => {
    const first = await writeSnapshot(path.join(root, 'one.html'), { dataDir, env: env() });
    const second = await writeSnapshot(path.join(root, 'two.html'), { dataDir, env: env() });
    expect(second.bytes).toBe(first.bytes);
  });

  it('holds no credential, even when the environment is full of them', async () => {
    const file = path.join(root, 'secrets.html');
    await writeSnapshot(file, {
      dataDir,
      env: {
        ...env(),
        ANTHROPIC_API_KEY: 'sk-ant-not-a-real-key-0123456789',
        DIGIKEY_CLIENT_SECRET: 'digikey-secret-0123456789',
        MOUSER_API_KEY: '00000000-1111-2222-3333-444444444444',
      },
    });
    const html = await readFile(file, 'utf8');
    expect(html).not.toContain('sk-ant-');
    expect(html).not.toContain('digikey-secret');
    expect(html).not.toContain('444444444444');
  });
});
