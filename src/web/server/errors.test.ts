import { describe, expect, it } from 'vitest';

import { CacheMissError } from '../../cache/cache.js';
import { ValidationError } from '../../core/validation-error.js';
import { DbError } from '../../db/database.js';
import { ChipAgentError } from '../../errors.js';
import { createRedactor } from '../../log/redact.js';
import { WebError, failureFor, statusFor } from './errors.js';

const redact = createRedactor({ secrets: ['super-secret-key'] });
const plain = (value: unknown): unknown => value;

class DigiKeyError extends ChipAgentError {}
class MysteryError extends ChipAgentError {}

describe('statusFor', () => {
  it('takes a WebError at its word', () => {
    expect(statusFor(new WebError(429, 'WEB_BUSY', 'too many runs'))).toBe(429);
  });

  it('maps a code the table names', () => {
    expect(statusFor(new CacheMissError('CACHE_MISS', 'not cached'))).toBe(409);
    expect(statusFor(new ChipAgentError('NEXAR_BUDGET_EXHAUSTED', 'no budget'))).toBe(402);
    expect(statusFor(new ChipAgentError('WEB_ROUTE_PATTERN', 'bad pattern'))).toBe(500);
  });

  it('maps any _NOT_FOUND code to 404', () => {
    expect(statusFor(new DbError('DB_PART_NOT_FOUND', 'no such part'))).toBe(404);
  });

  it('falls back to the class when the code says nothing', () => {
    expect(statusFor(new DigiKeyError('DIGIKEY_HTTP', 'upstream said no'))).toBe(502);
    expect(statusFor(new ValidationError('Part', []))).toBe(400);
  });

  it('treats an unknown error class as the failure of this server', () => {
    expect(statusFor(new MysteryError('WHO_KNOWS', 'unmapped'))).toBe(500);
    expect(statusFor(new Error('plain'))).toBe(500);
    expect(statusFor('a string')).toBe(500);
  });
});

describe('failureFor', () => {
  it('says nothing about an error it does not recognise', () => {
    const failure = failureFor(new Error('connection string: super-secret-key'), plain);
    expect(failure).toStrictEqual({
      status: 500,
      internal: true,
      body: {
        error: {
          code: 'INTERNAL',
          message: 'the server failed to handle the request',
          status: 500,
        },
      },
    });
  });

  it('carries details on a client error', () => {
    const error = new ValidationError('Part', [
      { path: 'vinMax', message: 'expected a number', received: '3 V to 32 V' },
    ]);
    const failure = failureFor(error, plain);
    expect(failure.status).toBe(400);
    expect(failure.internal).toBe(false);
    expect(failure.body.error.details).toStrictEqual({
      subject: 'Part',
      issues: [{ path: 'vinMax', message: 'expected a number', received: '3 V to 32 V' }],
    });
  });

  it('drops details on a server error but keeps the code', () => {
    const error = new DbError('DB_OPEN_FAILED', 'cannot open', { details: { file: '/data/x' } });
    const failure = failureFor(error, plain);
    expect(failure.status).toBe(500);
    expect(failure.internal).toBe(true);
    expect(failure.body.error).toStrictEqual({
      code: 'DB_OPEN_FAILED',
      message: 'cannot open',
      status: 500,
    });
  });

  it('redacts the message and the details of what it does send', () => {
    const error = new ValidationError('Config', [
      { path: 'key', message: 'rejected super-secret-key', received: 'super-secret-key' },
    ]);
    const failure = failureFor(error, redact);
    expect(JSON.stringify(failure.body)).not.toContain('super-secret-key');
    expect(failure.body.error.message).toContain('[redacted]');
  });
});
