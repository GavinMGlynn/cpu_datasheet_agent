import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { part as partFixture, toolCallRecord } from '../../../test/helpers/core-fixtures.js';
import { createTestApi, type TestApi } from '../../../test/helpers/web-api.js';
import { registerHealth } from './health.js';

let api: TestApi;

beforeEach(async () => {
  api = await createTestApi({ register: registerHealth });
  api.repositories.parts.upsertPart(partFixture());
  await api.appendLedger([toolCallRecord({ id: '00000000-0000-4000-8000-000000000001' })]);
});

afterEach(async () => {
  await api.close();
});

describe('GET /api/health', () => {
  it('reports the database, the migrations, the ledger and the tools', async () => {
    const result = await api.get('/api/health');
    expect(result.status).toBe(200);
    const body = result.body as {
      version: string;
      database: { migrations: string[]; totals: { parts: number } };
      ledger: { records: number; malformed: number };
      poppler: { available: boolean; versions?: Record<string, string> };
    };
    expect(body.version).toBe('1.0.0-test');
    expect(body.database.migrations.length).toBeGreaterThan(0);
    expect(body.database.totals.parts).toBe(1);
    expect(body.ledger).toMatchObject({ records: 1, malformed: 0 });
    expect(body.poppler.available).toBe(true);
    expect(Object.keys(body.poppler.versions ?? {})).toContain('pdftotext');
  });

  it('says which credentials are present and never what they are', async () => {
    const result = await api.get('/api/health');
    const body = result.body as { credentials: Record<string, boolean> };
    expect(body.credentials).toStrictEqual({
      digikey: false,
      mouser: false,
      nexar: false,
      anthropic: false,
    });
    expect(result.text).not.toMatch(/secret|api[-_]?key/iu);
  });

  it('reports poppler as absent when the runner has none', async () => {
    const without = await createTestApi({ register: registerHealth, poppler: false });
    const result = await without.get('/api/health');
    expect((result.body as { poppler: { available: boolean } }).poppler).toStrictEqual({
      available: false,
    });
    await without.close();
  });

  it('reports every credential present without printing one', async () => {
    const configured = await createTestApi({
      register: registerHealth,
      env: {
        DIGIKEY_CLIENT_ID: 'digikey-client-id-value',
        DIGIKEY_CLIENT_SECRET: 'digikey-client-secret-value',
        MOUSER_API_KEY: 'mouser-api-key-value',
        NEXAR_CLIENT_ID: 'nexar-client-id-value',
        NEXAR_CLIENT_SECRET: 'nexar-client-secret-value',
        ANTHROPIC_API_KEY: 'sk-ant-not-a-real-key-value',
      },
    });
    const result = await configured.get('/api/health');
    expect((result.body as { credentials: Record<string, boolean> }).credentials).toStrictEqual({
      digikey: true,
      mouser: true,
      nexar: true,
      anthropic: true,
    });
    for (const secret of ['digikey-client-secret-value', 'mouser-api-key-value', 'sk-ant-']) {
      expect(result.text).not.toContain(secret);
    }
    await configured.close();
  });
});

describe('GET /api/sources', () => {
  it('lists the databases the site can read', async () => {
    const result = await api.get('/api/sources');
    const body = result.body as { sources: { id: string; writable: boolean }[] };
    expect(body.sources[0]).toMatchObject({ id: 'live', writable: true });
  });
});

describe('GET /api/meta', () => {
  it('states the vocabulary the front end builds its controls from', async () => {
    const result = await api.get('/api/meta');
    const body = result.body as {
      parameterKeys: string[];
      classificationAxes: string[];
      partStatuses: string[];
      prompts: string[];
      model: string;
    };
    expect(body.parameterKeys).toHaveLength(30);
    expect(body.classificationAxes.length).toBeGreaterThan(0);
    expect(body.partStatuses).toContain('needs_human');
    expect(body.prompts).toContain('extract.v1');
    expect(body.model.length).toBeGreaterThan(0);
  });
});

describe('GET /api/ping', () => {
  it('answers whoever asks, and names them when they are signed in', async () => {
    expect((await api.get('/api/ping')).body).toMatchObject({ ok: true, signedInAs: 'tester' });
  });
});

describe('payload shape', () => {
  it('keeps the shape of the health report', async () => {
    const body = (await api.get('/api/health')).body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toMatchSnapshot();
  });
});
