import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { part as partFixture } from '../../test/helpers/core-fixtures.js';
import { createTestApi, type TestApi } from '../../test/helpers/web-api.js';
import { ValidationError } from '../core/validation-error.js';
import { createAuditor } from './audit.js';
import type { OpenSource } from './data/sources.js';

let api: TestApi;
let opened: OpenSource;

const draft = {
  actor: 'gavin',
  action: 'parameter.correct',
  targetKind: 'parameter',
  targetId: 'TPS54331DR:vinMax',
  reason: 'the ordering table says 28 V',
  before: { value: 30, unit: 'V' },
};

beforeEach(async () => {
  api = await createTestApi({ register: () => undefined });
  opened = await api.sources.open('live');
});

afterEach(async () => {
  await api.close();
});

describe('createAuditor', () => {
  it('records the change it wrapped, stamping the id and the time', () => {
    const auditor = createAuditor({
      clock: () => new Date('2026-09-12T01:02:03.000Z'),
      newId: () => '11111111-2222-4333-8444-555555555555',
    });
    const { event, result } = auditor.around(opened, draft, () => ({
      after: { value: 28, unit: 'V' },
      result: 'stored',
    }));
    expect(result).toBe('stored');
    expect(event).toMatchObject({
      id: '11111111-2222-4333-8444-555555555555',
      at: '2026-09-12T01:02:03.000Z',
      before: { value: 30, unit: 'V' },
      after: { value: 28, unit: 'V' },
    });
    expect(opened.repositories.audit.get(event.id)).toStrictEqual(event);
  });

  it('records a change that removed something, with no after', () => {
    const auditor = createAuditor({ clock: () => new Date('2026-09-12T00:00:00Z') });
    const { event } = auditor.around(
      opened,
      { ...draft, action: 'cache.purge', targetKind: 'cache' },
      () => ({ result: 'gone' }),
    );
    expect(event.after).toBeUndefined();
  });

  it('refuses a change with no reason, and writes nothing', () => {
    const auditor = createAuditor();
    expect(() => auditor.around(opened, { ...draft, reason: '' }, () => ({ result: 1 }))).toThrow(
      ValidationError,
    );
    expect(opened.repositories.audit.list()).toStrictEqual([]);
  });

  it('rolls the change back when the audit row cannot be written', () => {
    const auditor = createAuditor({ newId: () => 'not-a-uuid' });
    expect(() =>
      auditor.around(opened, draft, () => {
        opened.repositories.parts.upsertPart(partFixture());
        return { after: {}, result: 'stored' };
      }),
    ).toThrow(ValidationError);
    expect(opened.repositories.parts.getPart('TPS54331DR')).toBeUndefined();
    expect(opened.repositories.audit.list()).toStrictEqual([]);
  });

  it('rolls the audit row back when the change itself fails', () => {
    const auditor = createAuditor();
    expect(() =>
      auditor.around(opened, draft, () => {
        throw new Error('the store said no');
      }),
    ).toThrow('the store said no');
    expect(opened.repositories.audit.list()).toStrictEqual([]);
  });

  it('stamps a real id and time when it is given neither', () => {
    const auditor = createAuditor();
    const { event } = auditor.around(opened, draft, () => ({ result: 1 }));
    expect(event.id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(Date.parse(event.at)).toBeGreaterThan(0);
  });
});
