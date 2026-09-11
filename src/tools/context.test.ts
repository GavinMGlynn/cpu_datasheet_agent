import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig, type Config } from '../config.js';
import { createToolContext } from './context.js';
import { NO_SPEND_POLICY } from './policy.js';

let root: string;

function config(overrides: Record<string, string> = {}): Config {
  return loadConfig({ DATA_DIR: root, ...overrides });
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'context-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('createToolContext', () => {
  it('wires the cache, database, PDF toolkit and ledger under the data directory', async () => {
    const { context, db } = await createToolContext({ config: config() });
    try {
      expect(context.cache.stats).toEqual({
        hits: 0,
        misses: 0,
        expired: 0,
        forced: 0,
        joined: 0,
      });
      expect(context.repositories.nexarBudget.limit()).toBe(90);
      expect(context.ledger.sessionId).toMatch(/[0-9a-f-]{36}/);
      expect(context.headless).toBe(true);
      expect(context.policy.allowConfirmedSpend).toBe(true);
      expect(new Date(context.now()).toISOString()).toBe(context.now());
      expect(context.newId()).toMatch(/[0-9a-f-]{36}/);
      expect(context.toolkit).toBeDefined();
    } finally {
      db.close();
    }
  });

  it('leaves out a distributor with no credentials rather than failing on first use', async () => {
    const { context, db } = await createToolContext({ config: config() });
    try {
      expect(context.digikey).toBeUndefined();
      expect(context.mouser).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it('builds the distributors that are configured', async () => {
    const { context, db } = await createToolContext({
      config: config({
        DIGIKEY_CLIENT_ID: 'id-abc',
        DIGIKEY_CLIENT_SECRET: 'secret-xyz',
        MOUSER_API_KEY: 'key-abc',
      }),
    });
    try {
      expect(context.digikey?.currency).toBe('AUD');
      expect(context.mouser?.currency).toBe('AUD');
    } finally {
      db.close();
    }
  });

  it('takes the policy, session and clock it is given', async () => {
    const { context, db } = await createToolContext({
      config: config(),
      sessionId: 'session-abc',
      policy: NO_SPEND_POLICY,
      headless: false,
      now: () => '2026-09-11T00:00:00.000Z',
      newId: () => 'fixed-id',
    });
    try {
      expect(context.ledger.sessionId).toBe('session-abc');
      expect(context.policy).toBe(NO_SPEND_POLICY);
      expect(context.headless).toBe(false);
      expect(context.now()).toBe('2026-09-11T00:00:00.000Z');
      expect(context.newId()).toBe('fixed-id');
    } finally {
      db.close();
    }
  });

  it('opens the same database again on a second run', async () => {
    const first = await createToolContext({ config: config() });
    first.context.repositories.datasheets.record({
      url: 'https://example.test/a.pdf',
      sha256: 'a'.repeat(64),
      pageCount: 2,
      fetchedAt: '2026-09-11T00:00:00.000Z',
      localPath: path.join(root, 'a.pdf'),
      coversMpns: [],
    });
    first.db.close();

    const second = await createToolContext({ config: config() });
    try {
      expect(second.context.repositories.datasheets.getBySha('a'.repeat(64))).toBeDefined();
    } finally {
      second.db.close();
    }
  });
});
