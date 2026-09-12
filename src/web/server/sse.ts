/**
 * Server-sent events.
 *
 * A run reports turns, cost and tool calls while it is happening, which is a
 * one-way stream from server to browser — exactly what this protocol is, and
 * three lines of client code instead of a socket library. The stream survives
 * a reload by way of `Last-Event-ID`: every event carries an id, and the run
 * registry replays from one (19E.2).
 */

export interface SseSink {
  statusCode: number;
  setHeader(name: string, value: string | readonly string[]): unknown;
  write(chunk: string): boolean;
  end(chunk?: Uint8Array | string): unknown;
  once(event: 'drain', listener: () => void): unknown;
}

export interface SseOptions {
  /** Milliseconds between keep-alive comments. Zero disables them. */
  readonly heartbeatMs?: number;
  /** How long a browser should wait before reconnecting, in milliseconds. */
  readonly retryMs?: number;
  /** Serialiser for event data. The server passes its redactor. */
  readonly serialise?: (value: unknown) => string;
  /**
   * Starts a repeating timer and returns the function that stops it. The
   * default unrefs the timer: a stream nobody is reading must not be the
   * reason the process stays alive.
   */
  readonly startTimer?: (handler: () => void, ms: number) => () => void;
}

export interface SseStream {
  /** Sends one named event. Returns false once the stream is closed. */
  send(event: string, data: unknown, id?: string): boolean;
  /** Sends a comment line, which keeps proxies and browsers from timing out. */
  comment(text: string): boolean;
  close(): void;
  readonly closed: boolean;
  /** Events written so far, which is what a reconnecting client counts from. */
  readonly sent: number;
}

function defaultTimer(handler: () => void, ms: number): () => void {
  const handle = setInterval(handler, ms);
  handle.unref();
  return () => {
    clearInterval(handle);
  };
}

const DEFAULT_HEARTBEAT_MS = 15_000;
const DEFAULT_RETRY_MS = 2_000;

function encode(field: string, value: string): string {
  return value
    .split('\n')
    .map((line) => `${field}: ${line}\n`)
    .join('');
}

/**
 * Takes over the response and returns the stream.
 *
 * `X-Accel-Buffering` is set because a proxy that buffers an event stream
 * turns a live view into a surprise five minutes later, and this is the one
 * header that tells the common ones not to.
 */
export function openSse(sink: SseSink, options: SseOptions = {}): SseStream {
  const serialise =
    options.serialise ?? ((value: unknown): string => JSON.stringify(value ?? null));
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const startTimer = options.startTimer ?? defaultTimer;

  sink.statusCode = 200;
  sink.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  sink.setHeader('Cache-Control', 'no-store');
  sink.setHeader('Connection', 'keep-alive');
  sink.setHeader('X-Accel-Buffering', 'no');
  sink.write(`retry: ${String(options.retryMs ?? DEFAULT_RETRY_MS)}\n\n`);

  let closed = false;
  let sent = 0;
  let draining = false;

  const write = (payload: string): boolean => {
    if (closed) {
      return false;
    }
    if (!sink.write(payload)) {
      // The client is reading more slowly than the run produces events.
      // Heartbeats are skipped until it catches up; real events are not,
      // because dropping one would leave the page permanently wrong.
      draining = true;
      sink.once('drain', () => {
        draining = false;
      });
    }
    return true;
  };

  const stopHeartbeat =
    heartbeatMs > 0
      ? startTimer(() => {
          if (!draining) {
            write(': ping\n\n');
          }
        }, heartbeatMs)
      : undefined;

  const stream: SseStream = {
    get closed() {
      return closed;
    },
    get sent() {
      return sent;
    },
    send(event, data, id) {
      if (closed) {
        return false;
      }
      sent += 1;
      const payload = `${encode('id', id ?? String(sent))}${encode('event', event)}${encode(
        'data',
        serialise(data),
      )}\n`;
      return write(payload);
    },
    comment(text) {
      return write(`: ${text}\n\n`);
    },
    close() {
      if (closed) {
        return;
      }
      closed = true;
      if (stopHeartbeat !== undefined) {
        stopHeartbeat();
      }
      sink.end();
    },
  };
  return stream;
}
