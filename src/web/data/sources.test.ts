import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../../db/index.js';
import { LIVE_SOURCE, createSources, type Sources } from './sources.js';

let root: string;
let sources: Sources;

function paths(): { databaseFile: string; evalRunsDir: string } {
  return {
    databaseFile: path.join(root, 'data', 'chip.sqlite'),
    evalRunsDir: path.join(root, 'data', 'eval-runs'),
  };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'chip-web-sources-'));
  const { databaseFile, evalRunsDir } = paths();
  openDatabase(databaseFile).close();
  await mkdir(evalRunsDir, { recursive: true });
  openDatabase(path.join(evalRunsDir, 'run-b.sqlite')).close();
  openDatabase(path.join(evalRunsDir, 'run-a.sqlite')).close();
  await writeFile(path.join(evalRunsDir, 'notes.txt'), 'not a database');
  sources = createSources(paths());
});

afterEach(async () => {
  sources.close();
  await rm(root, { recursive: true, force: true });
});

describe('list', () => {
  it('puts the live store first and the evaluation runs in order', async () => {
    const listed = await sources.list();
    expect(listed.map((source) => source.id)).toStrictEqual([LIVE_SOURCE, 'run-a', 'run-b']);
    expect(listed.map((source) => source.kind)).toStrictEqual(['live', 'eval-run', 'eval-run']);
  });

  it('reports size and modification time of what exists', async () => {
    const [live] = await sources.list();
    expect(live?.exists).toBe(true);
    expect(live?.bytes).toBeGreaterThan(0);
    expect(live?.modifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
  });

  it('lists a live store that is not there yet without pretending it is', async () => {
    const empty = createSources({
      databaseFile: path.join(root, 'missing', 'chip.sqlite'),
      evalRunsDir: path.join(root, 'missing'),
    });
    const [live] = await empty.list();
    expect(live).toMatchObject({ exists: false, bytes: 0, modifiedAt: undefined });
    empty.close();
  });

  it('copes with no evaluation directory at all', async () => {
    const { databaseFile } = paths();
    const only = createSources({ databaseFile, evalRunsDir: path.join(root, 'nowhere') });
    expect(await only.list()).toHaveLength(1);
    only.close();
  });

  it('marks only the live store writable', async () => {
    const listed = await sources.list();
    expect(listed.map((source) => source.writable)).toStrictEqual([true, false, false]);
  });
});

describe('open', () => {
  it('opens a source and gives back its repositories', async () => {
    const opened = await sources.open(LIVE_SOURCE);
    expect(opened.repositories.parts.findParts()).toStrictEqual([]);
    expect(opened.source.id).toBe(LIVE_SOURCE);
  });

  it('keeps one connection per source', async () => {
    const first = await sources.open('run-a');
    const second = await sources.open('run-a');
    expect(second).toBe(first);
  });

  it('says plainly when a source is not one it knows', async () => {
    await expect(sources.open('nonsense')).rejects.toThrow(
      expect.objectContaining({ code: 'WEB_SOURCE_NOT_FOUND', status: 404 }),
    );
  });

  it('refuses to write to an evaluation database', async () => {
    await expect(sources.requireWritable('run-a')).rejects.toThrow(
      expect.objectContaining({ code: 'WEB_SOURCE_READ_ONLY', status: 403 }),
    );
    await expect(sources.requireWritable(LIVE_SOURCE)).resolves.toMatchObject({
      source: { writable: true },
    });
  });

  it('closes every connection it opened', async () => {
    const opened = await sources.open(LIVE_SOURCE);
    sources.close();
    expect(() => opened.db.raw.prepare('select 1').get()).toThrow(/not open/u);
  });
});

describe('defaults', () => {
  it('points at the data directory this project uses', async () => {
    const defaults = createSources();
    const listed = await defaults.list();
    expect(listed[0]?.file).toBe('data/chip.sqlite');
    defaults.close();
  });
});
