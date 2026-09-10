import { afterEach, describe, expect, it, vi } from 'vitest';

import { LOG_LEVELS } from '../config.js';
import { createLogger, isLogLevel, stderrSink } from './logger.js';

const clock = (): Date => new Date('2026-09-10T10:00:00Z');

function capture() {
  const lines: string[] = [];
  return { lines, sink: (line: string): void => void lines.push(line) };
}

describe('createLogger', () => {
  it('emits one JSON line per record with ts, level, msg, then fields', () => {
    const { lines, sink } = capture();
    const logger = createLogger({ level: 'debug', sink, clock });

    logger.info('hello', { part: 'TPS54331' });

    expect(lines).toEqual([
      '{"ts":"2026-09-10T10:00:00.000Z","level":"info","msg":"hello","part":"TPS54331"}',
    ]);
  });

  it.each([
    ['debug', ['debug', 'info', 'warn', 'error']],
    ['info', ['info', 'warn', 'error']],
    ['warn', ['warn', 'error']],
    ['error', ['error']],
  ] as const)('at level %s emits %j', (level, expected) => {
    const { lines, sink } = capture();
    const logger = createLogger({ level, sink, clock });

    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    expect(lines.map((line) => (JSON.parse(line) as { level: string }).level)).toEqual(expected);
    expect(logger.level).toBe(level);
  });

  it('merges bound fields, child fields, and call fields, later ones winning', () => {
    const { lines, sink } = capture();
    const logger = createLogger({ level: 'info', sink, clock, fields: { app: 'chip', run: 1 } });
    const child = logger.child({ run: 2, mpn: 'X' });

    child.info('m', { mpn: 'Y', extra: true });
    logger.info('parent');

    expect(JSON.parse(lines[0] ?? '')).toEqual({
      ts: '2026-09-10T10:00:00.000Z',
      level: 'info',
      msg: 'm',
      app: 'chip',
      run: 2,
      mpn: 'Y',
      extra: true,
    });
    expect(JSON.parse(lines[1] ?? '')).toEqual({
      ts: '2026-09-10T10:00:00.000Z',
      level: 'info',
      msg: 'parent',
      app: 'chip',
      run: 1,
    });
  });

  it('applies the redactor to the whole record before serialising', () => {
    const { lines, sink } = capture();
    const logger = createLogger({
      level: 'info',
      sink,
      clock,
      redact: (value) => ({ ...(value as object), msg: 'scrubbed' }),
    });

    logger.info('original');

    expect(JSON.parse(lines[0] ?? '')).toMatchObject({ msg: 'scrubbed' });
  });

  it('uses the real clock by default', () => {
    const { lines, sink } = capture();
    const before = Date.now();
    createLogger({ level: 'info', sink }).info('now');
    const ts = (JSON.parse(lines[0] ?? '') as { ts: string }).ts;

    expect(Date.parse(ts)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(ts)).toBeLessThanOrEqual(Date.now() + 1000);
  });
});

describe('stderrSink', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes the line with a newline to stderr and never to stdout', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    stderrSink('{"a":1}');
    createLogger({ level: 'info' }).info('default sink');

    expect(stderr).toHaveBeenCalledTimes(2);
    expect(stderr.mock.calls[0]?.[0]).toBe('{"a":1}\n');
    expect(String(stderr.mock.calls[1]?.[0])).toContain('"msg":"default sink"');
    expect(stdout).not.toHaveBeenCalled();
  });
});

describe('isLogLevel', () => {
  it.each(LOG_LEVELS)('accepts %s', (level) => {
    expect(isLogLevel(level)).toBe(true);
  });

  it('rejects other strings', () => {
    expect(isLogLevel('verbose')).toBe(false);
    expect(isLogLevel('')).toBe(false);
  });
});
