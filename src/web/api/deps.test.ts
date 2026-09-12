import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { part as partFixture } from '../../../test/helpers/core-fixtures.js';
import { createTestApi, type TestApi } from '../../../test/helpers/web-api.js';
import type { RequestContext } from '../server/app.js';
import { open, openSource, openWritableSource, read, requirePart, write } from './deps.js';

let api: TestApi;

/** The two fields these helpers read from a request. */
function context(query: string): RequestContext {
  return { query: new URLSearchParams(query) } as unknown as RequestContext;
}

beforeEach(async () => {
  api = await createTestApi({
    register: (router) => {
      router.get(
        '/api/open',
        open((ctx) => {
          ctx.respond.json(ctx.response, ctx.facts, { access: 'open' });
        }),
      );
      router.get(
        '/api/read',
        read((ctx) => {
          ctx.respond.json(ctx.response, ctx.facts, { access: 'read' });
        }),
      );
      router.post(
        '/api/write',
        write((ctx) => {
          ctx.respond.json(ctx.response, ctx.facts, { access: 'write' });
        }),
      );
    },
  });
});

afterEach(async () => {
  await api.close();
});

describe('access helpers', () => {
  it('label a route with what it needs', async () => {
    expect((await api.get('/api/open')).status).toBe(200);
    expect((await api.get('/api/read')).status).toBe(200);
    expect((await api.post('/api/write')).status).toBe(200);
  });
});

describe('openSource', () => {
  it('defaults to the live store', async () => {
    const opened = await openSource(context(''), api.deps);
    expect(opened.source.id).toBe('live');
  });

  it('opens the database the query names', async () => {
    await expect(openSource(context('source=nowhere'), api.deps)).rejects.toThrow(
      expect.objectContaining({ code: 'WEB_SOURCE_NOT_FOUND' }),
    );
  });

  it('refuses to write to a source that is evidence', async () => {
    await expect(openWritableSource(context(''), api.deps)).resolves.toMatchObject({
      source: { writable: true },
    });
    await expect(openWritableSource(context('source=nowhere'), api.deps)).rejects.toThrow(
      expect.objectContaining({ code: 'WEB_SOURCE_NOT_FOUND' }),
    );
  });
});

describe('requirePart', () => {
  it('returns a stored part and refuses one that is not there', async () => {
    api.repositories.parts.upsertPart(partFixture());
    const opened = await api.sources.open('live');
    expect(requirePart(opened, 'TPS54331DR').mpn).toBe('TPS54331DR');
    expect(() => requirePart(opened, 'NOTHING-1')).toThrow(
      expect.objectContaining({ code: 'WEB_PART_NOT_FOUND', status: 404 }),
    );
  });
});
