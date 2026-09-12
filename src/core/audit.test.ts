import { describe, expect, it } from 'vitest';

import { UUID } from '../../test/helpers/core-fixtures.js';
import { AuditDraft, AuditEvent } from './audit.js';

function event(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: UUID,
    at: '2026-09-12T00:00:00Z',
    actor: 'gavin',
    action: 'parameter.correct',
    targetKind: 'parameter',
    targetId: 'TPS54331DR:vinMax',
    reason: 'the ordering table says 28 V, not 30 V',
    before: { value: 30, unit: 'V' },
    after: { value: 28, unit: 'V' },
    ...overrides,
  };
}

describe('AuditEvent', () => {
  it('accepts a change with both sides and a reason', () => {
    expect(AuditEvent.parse(event())).toMatchObject({ action: 'parameter.correct' });
  });

  it('accepts a change that created something, and one that removed it', () => {
    expect(AuditEvent.safeParse(event({ before: undefined })).success).toBe(true);
    expect(AuditEvent.safeParse(event({ after: undefined })).success).toBe(true);
  });

  it('refuses a change with no reason worth the name', () => {
    expect(AuditEvent.safeParse(event({ reason: '' })).success).toBe(false);
    expect(AuditEvent.safeParse(event({ reason: 'x' })).success).toBe(false);
    expect(AuditEvent.safeParse(event({ reason: undefined })).success).toBe(false);
  });

  it('refuses an action that is not a dotted name', () => {
    for (const action of ['correct', 'Parameter.Correct', 'parameter correct', '']) {
      expect(AuditEvent.safeParse(event({ action })).success).toBe(false);
    }
  });

  it('refuses a target kind it does not know, and an empty target', () => {
    expect(AuditEvent.safeParse(event({ targetKind: 'database' })).success).toBe(false);
    expect(AuditEvent.safeParse(event({ targetId: '' })).success).toBe(false);
  });

  it('refuses an actor nobody could be, and an id that is not a uuid', () => {
    expect(AuditEvent.safeParse(event({ actor: '' })).success).toBe(false);
    expect(AuditEvent.safeParse(event({ id: 'not-a-uuid' })).success).toBe(false);
  });

  it('refuses a field it has never heard of', () => {
    expect(AuditEvent.safeParse(event({ severity: 'high' })).success).toBe(false);
  });
});

describe('AuditDraft', () => {
  it('is the same event without the two fields the store stamps', () => {
    const { id: _id, at: _at, ...draft } = event();
    expect(AuditDraft.parse(draft)).toMatchObject({ targetId: 'TPS54331DR:vinMax' });
    expect(AuditDraft.safeParse(event()).success).toBe(false);
  });
});
