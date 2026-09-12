import { createLogger, type Logger } from '../../src/log/logger.js';
import type { HttpRequestLike, IncomingHeaders, ResponseSink } from '../../src/web/server/app.js';

/** A response that records what was written to it, standing in for a socket. */
export interface RecordedResponse extends ResponseSink {
  readonly headers: Record<string, string>;
  readonly chunks: string[];
  body: string;
  writableEnded: boolean;
  accepting: boolean;
  drain(): void;
  json(): unknown;
}

export function recordedResponse(): RecordedResponse {
  const drains: (() => void)[] = [];
  return {
    statusCode: 0,
    headers: {},
    chunks: [],
    body: '',
    writableEnded: false,
    accepting: true,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    write(chunk: string) {
      this.chunks.push(chunk);
      return this.accepting;
    },
    end(chunk?: Uint8Array | string) {
      if (chunk !== undefined) {
        this.body = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      }
      this.writableEnded = true;
    },
    once(_event: 'drain', listener: () => void) {
      drains.push(listener);
    },
    drain() {
      for (const listener of drains.splice(0)) {
        listener();
      }
    },
    json(): unknown {
      return JSON.parse(this.body === '' ? 'null' : this.body) as unknown;
    },
  };
}

export interface RequestOptions {
  readonly method?: string;
  readonly url?: string;
  readonly headers?: IncomingHeaders;
  /** Body as a string, or as the chunks it arrives in. */
  readonly body?: string | readonly string[];
}

export function recordedRequest(options: RequestOptions = {}): HttpRequestLike {
  const chunks =
    options.body === undefined
      ? []
      : typeof options.body === 'string'
        ? [options.body]
        : options.body;
  return {
    method: options.method ?? 'GET',
    url: options.url ?? '/',
    headers: options.headers ?? {},
    // eslint sees no await here because there is none: the body is already in
    // memory, and the shape has to be an async iterable because that is what
    // `IncomingMessage` is.
    [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
      const encoder = new TextEncoder();
      let index = 0;
      return {
        next(): Promise<IteratorResult<Uint8Array>> {
          const chunk = chunks[index++];
          return Promise.resolve(
            chunk === undefined
              ? { done: true, value: undefined }
              : { done: false, value: encoder.encode(chunk) },
          );
        },
      };
    },
  };
}

export interface CapturedLogger {
  readonly logger: Logger;
  readonly lines: Record<string, unknown>[];
  of(message: string): Record<string, unknown>[];
}

export function capturedLogger(): CapturedLogger {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({
    level: 'debug',
    sink: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
  });
  return {
    logger,
    lines,
    of(message: string) {
      return lines.filter((line) => line.msg === message);
    },
  };
}
