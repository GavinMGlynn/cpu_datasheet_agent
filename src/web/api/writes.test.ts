import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  escalation as escalationFixture,
  part as partFixture,
  UUID,
} from '../../../test/helpers/core-fixtures.js';
import { createTestApi, type TestApi } from '../../../test/helpers/web-api.js';
import { sha256Of } from '../../cache/store.js';
import { loadGoldenSet } from '../../eval/load.js';
import { registerApi } from './index.js';

let api: TestApi;
let goldenDir: string;

const correction = {
  actor: 'gavin',
  reason: 'the ordering table on page 2 says 28 V',
  value: { value: 28, unit: 'V' },
  note: 'page 2, ordering information',
};

beforeEach(async () => {
  goldenDir = await mkdtemp(path.join(tmpdir(), 'chip-web-golden-'));
  api = await createTestApi({ register: registerApi, goldenDir });
  api.repositories.parts.upsertPart(partFixture());
  api.repositories.escalations.create(escalationFixture());
});

afterEach(async () => {
  await api.close();
  await rm(goldenDir, { recursive: true, force: true });
});

describe('correcting a parameter', () => {
  it('stores the human value, keeps what the model said in the audit row, and says so', async () => {
    const result = await api.post('/api/parts/TPS54331DR/parameters/vinMax', correction);
    expect(result.status).toBe(200);
    const body = result.body as {
      event: { action: string; before: { value: unknown }; after: { value: unknown } };
      parameter: { value: { value: number }; provenance: { source: string }; confidence: string };
    };
    expect(body.parameter.value.value).toBe(28);
    expect(body.parameter.provenance.source).toBe('human');
    expect(body.parameter.confidence).toBe('verified');
    expect(body.event.action).toBe('parameter.correct');
    expect(body.event.before).toMatchObject({ value: { value: 28, unit: 'V' } });

    const stored = api.repositories.parts.getPart('TPS54331DR');
    expect(stored?.parameters.vinMax.provenance.source).toBe('human');
    expect(api.repositories.audit.list()).toHaveLength(1);
  });

  it('refuses a correction with no reason, no note, or no actor', async () => {
    const { reason: _reason, ...noReason } = correction;
    const { note: _note, ...noNote } = correction;
    const { actor: _actor, ...noActor } = correction;
    for (const body of [noReason, noNote, noActor]) {
      const result = await api.post('/api/parts/TPS54331DR/parameters/vinMax', body);
      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    }
    expect(api.repositories.audit.list()).toStrictEqual([]);
  });

  it('rejects a value the schema will not have, and changes nothing', async () => {
    const result = await api.post('/api/parts/TPS54331DR/parameters/vinMax', {
      ...correction,
      value: '3 V to 32 V',
    });
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    const stored = api.repositories.parts.getPart('TPS54331DR');
    expect(stored?.parameters.vinMax.value).toStrictEqual({ value: 28, unit: 'V' });
    expect(api.repositories.audit.list()).toStrictEqual([]);
  });

  it('404s a part or a parameter key it does not have', async () => {
    expect((await api.post('/api/parts/NOTHING-1/parameters/vinMax', correction)).status).toBe(404);
    expect((await api.post('/api/parts/TPS54331DR/parameters/nonsense', correction)).status).toBe(
      400,
    );
  });

  it('refuses to write to an evaluation database', async () => {
    const result = await api.post(
      '/api/parts/TPS54331DR/parameters/vinMax?source=nowhere',
      correction,
    );
    expect(result.status).toBe(404);
  });
});

describe('changing a status', () => {
  it('records the change with what it was before', async () => {
    const result = await api.post('/api/parts/TPS54331DR/status', {
      actor: 'gavin',
      reason: 'the conflict was resolved in the ordering table',
      status: 'needs_human',
    });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      status: 'needs_human',
      event: { action: 'part.status', before: 'extracted', after: 'needs_human' },
    });
    expect(api.repositories.parts.getPart('TPS54331DR')?.status).toBe('needs_human');
  });

  it('refuses a status the schema does not have', async () => {
    const result = await api.post('/api/parts/TPS54331DR/status', {
      actor: 'gavin',
      reason: 'because',
      status: 'pending',
    });
    expect(result.status).toBe(400);
  });
});

describe('escalations', () => {
  it('lists them, open and resolved', async () => {
    expect(
      ((await api.get('/api/escalations')).body as { escalations: unknown[] }).escalations,
    ).toHaveLength(1);
    expect(
      ((await api.get('/api/escalations?resolved=false')).body as { escalations: unknown[] })
        .escalations,
    ).toHaveLength(1);
    expect(
      ((await api.get('/api/escalations?resolved=true')).body as { escalations: unknown[] })
        .escalations,
    ).toStrictEqual([]);
    expect(
      ((await api.get('/api/escalations?mpn=TPS54331DR')).body as { escalations: unknown[] })
        .escalations,
    ).toHaveLength(1);
  });

  it('resolves one, recording who answered and what they said', async () => {
    const result = await api.post(`/api/escalations/${UUID}/resolve`, {
      actor: 'gavin',
      reason: 'checked the datasheet myself',
      answer: '28 V is right; Digi-Key lists the absolute maximum',
    });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      event: { action: 'escalation.resolve', before: null },
      escalation: { resolution: { by: 'gavin' } },
    });
    expect(api.repositories.escalations.list({ resolved: true })).toHaveLength(1);
  });

  it('404s an escalation it does not hold, and refuses an empty answer', async () => {
    expect(
      (
        await api.post('/api/escalations/00000000-0000-4000-8000-000000000099/resolve', {
          actor: 'gavin',
          reason: 'checked it',
          answer: 'yes',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await api.post(`/api/escalations/${UUID}/resolve`, {
          actor: 'gavin',
          reason: 'checked it',
          answer: '',
        })
      ).status,
    ).toBe(400);
  });
});

describe('the golden set', () => {
  const goldenPart = (): unknown => {
    const [first] = loadGoldenSet();
    if (first === undefined) {
      throw new Error('the golden set is empty');
    }
    return first.part;
  };

  it('writes a new file and records who reviewed it', async () => {
    const part = goldenPart() as { mpn: string };
    const result = await api.request('PUT', `/api/golden/${encodeURIComponent(part.mpn)}`, {
      actor: 'gavin',
      reason: 'human review of the ordering table',
      part,
    });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ event: { action: 'golden.create' } });
    const written: unknown = JSON.parse(
      await readFile(path.join(goldenDir, `${part.mpn}.json`), 'utf8'),
    );
    expect(written).toMatchObject({ mpn: part.mpn });
  });

  it('records an update when the file was already there', async () => {
    const part = goldenPart() as { mpn: string };
    await writeFile(path.join(goldenDir, `${part.mpn}.json`), JSON.stringify(part));
    const result = await api.request('PUT', `/api/golden/${encodeURIComponent(part.mpn)}`, {
      actor: 'gavin',
      reason: 'corrected the switching frequency after reading page 5',
      part,
    });
    expect(result.body).toMatchObject({ event: { action: 'golden.update' } });
  });

  it('refuses a body for a different part, and one that is not a golden part', async () => {
    const part = goldenPart() as { mpn: string };
    const mismatch = await api.request('PUT', '/api/golden/OTHER-1', {
      actor: 'gavin',
      reason: 'human review',
      part,
    });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body).toMatchObject({ error: { code: 'WEB_GOLDEN_MPN_MISMATCH' } });
    const invalid = await api.request('PUT', `/api/golden/${encodeURIComponent(part.mpn)}`, {
      actor: 'gavin',
      reason: 'human review',
      part: { mpn: part.mpn },
    });
    expect(invalid.status).toBe(400);
  });
});

describe('purging a cache entry', () => {
  it('removes it and records why', async () => {
    const bytes = Buffer.from('cached');
    const hash = 'a'.repeat(64);
    await api.deps.store.put({ namespace: 'pdf_text', hash }, bytes, {
      createdAt: '2026-09-11T00:00:00Z',
      contentType: 'text/plain',
      size: bytes.byteLength,
      sha256: sha256Of(bytes),
    });
    const result = await api.post('/api/cache/purge', {
      actor: 'gavin',
      reason: 'the datasheet was replaced upstream',
      namespace: 'pdf_text',
      hash,
    });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ event: { action: 'cache.purge' } });
    expect(await api.deps.store.has({ namespace: 'pdf_text', hash })).toBe(false);
  });

  it('404s an entry that is not there, and refuses a hash that is not one', async () => {
    const missing = await api.post('/api/cache/purge', {
      actor: 'gavin',
      reason: 'tidying up',
      namespace: 'pdf_text',
      hash: 'c'.repeat(64),
    });
    expect(missing.status).toBe(404);
    const bad = await api.post('/api/cache/purge', {
      actor: 'gavin',
      reason: 'tidying up',
      namespace: 'pdf_text',
      hash: 'not-a-hash',
    });
    expect(bad.status).toBe(400);
  });
});

describe('the audit trail', () => {
  it('lists what was changed, filtered by target, action and actor', async () => {
    await api.post('/api/parts/TPS54331DR/parameters/vinMax', correction);
    await api.post('/api/parts/TPS54331DR/status', {
      actor: 'someone else',
      reason: 'sending it back for a person to read',
      status: 'needs_human',
    });
    const all = (await api.get('/api/audit')).body as { total: number; items: unknown[] };
    expect(all.total).toBe(2);
    const byKind = (await api.get('/api/audit?targetKind=part')).body as { total: number };
    expect(byKind.total).toBe(1);
    const byActor = (await api.get('/api/audit?actor=someone%20else')).body as { total: number };
    expect(byActor.total).toBe(1);
    const byAction = (await api.get('/api/audit?action=parameter.correct')).body as {
      total: number;
    };
    expect(byAction.total).toBe(1);
    const byTarget = (await api.get('/api/audit?targetId=TPS54331DR:vinMax')).body as {
      total: number;
    };
    expect(byTarget.total).toBe(1);
  });

  it('pages', async () => {
    await api.post('/api/parts/TPS54331DR/parameters/vinMax', correction);
    const page = (await api.get('/api/audit?limit=1&offset=1')).body as { items: unknown[] };
    expect(page.items).toStrictEqual([]);
  });
});

describe('payload shape', () => {
  it('keeps the shape of an audit event', async () => {
    await api.post('/api/parts/TPS54331DR/parameters/vinMax', correction);
    const body = (await api.get('/api/audit')).body as { items: Record<string, unknown>[] };
    expect(Object.keys(body.items[0] ?? {}).sort()).toMatchSnapshot();
  });
});
