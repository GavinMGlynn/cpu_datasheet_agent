/** Converts between a value and the bytes the store persists. */
export interface Codec<T> {
  readonly name: 'json' | 'text' | 'bytes';
  readonly defaultContentType: string;
  encode(value: T): Buffer;
  decode(bytes: Buffer): T;
}

/**
 * JSON codec. `decode` trusts the stored bytes to have the shape `T`; callers
 * that need certainty validate the result with a schema.
 */
export function jsonCodec<T>(): Codec<T> {
  return {
    name: 'json',
    defaultContentType: 'application/json',
    encode: (value) => Buffer.from(JSON.stringify(value), 'utf8'),
    decode: (bytes) => JSON.parse(bytes.toString('utf8')) as T,
  };
}

export const textCodec: Codec<string> = {
  name: 'text',
  defaultContentType: 'text/plain; charset=utf-8',
  encode: (value) => Buffer.from(value, 'utf8'),
  decode: (bytes) => bytes.toString('utf8'),
};

export const bytesCodec: Codec<Buffer> = {
  name: 'bytes',
  defaultContentType: 'application/octet-stream',
  encode: (value) => Buffer.from(value),
  decode: (bytes) => Buffer.from(bytes),
};
