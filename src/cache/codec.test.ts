import { describe, expect, it } from 'vitest';

import { bytesCodec, jsonCodec, textCodec } from './codec.js';

describe('jsonCodec', () => {
  it('round-trips JSON values through UTF-8 bytes', () => {
    const codec = jsonCodec<{ a: number; s: string }>();
    const bytes = codec.encode({ a: 1, s: 'é' });
    expect(bytes.toString('utf8')).toBe('{"a":1,"s":"é"}');
    expect(codec.decode(bytes)).toEqual({ a: 1, s: 'é' });
    expect(codec.name).toBe('json');
    expect(codec.defaultContentType).toBe('application/json');
  });
});

describe('textCodec', () => {
  it('round-trips text', () => {
    const bytes = textCodec.encode('hello ✓');
    expect(textCodec.decode(bytes)).toBe('hello ✓');
    expect(textCodec.name).toBe('text');
    expect(textCodec.defaultContentType).toBe('text/plain; charset=utf-8');
  });
});

describe('bytesCodec', () => {
  it('copies buffers so callers cannot mutate stored bytes', () => {
    const original = Buffer.from([1, 2, 3]);
    const encoded = bytesCodec.encode(original);
    original[0] = 9;
    expect([...encoded]).toEqual([1, 2, 3]);
    const decoded = bytesCodec.decode(encoded);
    decoded[1] = 9;
    expect([...encoded]).toEqual([1, 2, 3]);
    expect(bytesCodec.name).toBe('bytes');
    expect(bytesCodec.defaultContentType).toBe('application/octet-stream');
  });
});
