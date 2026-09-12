import { describe, expect, it } from 'vitest';

import { openSse, type SseSink } from './sse.js';

interface FakeSink extends SseSink {
  readonly headers: Record<string, string>;
  readonly chunks: string[];
  accepting: boolean;
  ended: boolean;
  drain(): void;
}

function fakeSink(): FakeSink {
  const drains: (() => void)[] = [];
  return {
    statusCode: 0,
    headers: {},
    chunks: [],
    accepting: true,
    ended: false,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    write(chunk: string) {
      this.chunks.push(chunk);
      return this.accepting;
    },
    end() {
      this.ended = true;
    },
    once(_event: 'drain', listener: () => void) {
      drains.push(listener);
    },
    drain() {
      for (const listener of drains.splice(0)) {
        listener();
      }
    },
  };
}

/** A timer whose ticks the test fires by hand. */
function fakeTimer(): {
  start: (h: () => void, ms: number) => () => void;
  tick: () => void;
  ms: number;
  stopped: boolean;
} {
  const state = {
    handler: undefined as (() => void) | undefined,
    ms: 0,
    stopped: false,
    start(handler: () => void, ms: number) {
      state.handler = handler;
      state.ms = ms;
      return () => {
        state.stopped = true;
      };
    },
    tick() {
      state.handler?.();
    },
  };
  return state;
}

describe('openSse', () => {
  it('takes over the response with the headers a stream needs', () => {
    const sink = fakeSink();
    openSse(sink, { startTimer: fakeTimer().start });
    expect(sink.statusCode).toBe(200);
    expect(sink.headers).toStrictEqual({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    expect(sink.chunks[0]).toBe('retry: 2000\n\n');
  });

  it('honours a reconnection delay of its own', () => {
    const sink = fakeSink();
    openSse(sink, { retryMs: 500, startTimer: fakeTimer().start });
    expect(sink.chunks[0]).toBe('retry: 500\n\n');
  });

  it('numbers the events it sends', () => {
    const sink = fakeSink();
    const stream = openSse(sink, { startTimer: fakeTimer().start });
    expect(stream.send('turn', { turn: 1, costUsd: 0.4 })).toBe(true);
    stream.send('turn', { turn: 2 }, 'run-7:2');
    expect(sink.chunks[1]).toBe('id: 1\nevent: turn\ndata: {"turn":1,"costUsd":0.4}\n\n');
    expect(sink.chunks[2]).toBe('id: run-7:2\nevent: turn\ndata: {"turn":2}\n\n');
    expect(stream.sent).toBe(2);
  });

  it('splits multi-line data across data fields, as the protocol requires', () => {
    const sink = fakeSink();
    const stream = openSse(sink, {
      startTimer: fakeTimer().start,
      serialise: (value) => String(value),
    });
    stream.send('log', 'first\nsecond');
    expect(sink.chunks[1]).toBe('id: 1\nevent: log\ndata: first\ndata: second\n\n');
  });

  it('sends a comment', () => {
    const sink = fakeSink();
    const stream = openSse(sink, { startTimer: fakeTimer().start });
    expect(stream.comment('still here')).toBe(true);
    expect(sink.chunks[1]).toBe(': still here\n\n');
  });

  it('beats at the interval it was given, and stops when the stream closes', () => {
    const sink = fakeSink();
    const timer = fakeTimer();
    const stream = openSse(sink, { heartbeatMs: 9_000, startTimer: timer.start });
    expect(timer.ms).toBe(9_000);
    timer.tick();
    expect(sink.chunks[1]).toBe(': ping\n\n');
    stream.close();
    expect(timer.stopped).toBe(true);
    expect(sink.ended).toBe(true);
  });

  it('skips heartbeats while the client is behind, and resumes when it catches up', () => {
    const sink = fakeSink();
    const timer = fakeTimer();
    const stream = openSse(sink, { startTimer: timer.start });
    sink.accepting = false;
    stream.send('turn', { turn: 1 });
    const before = sink.chunks.length;
    timer.tick();
    expect(sink.chunks).toHaveLength(before);
    sink.accepting = true;
    sink.drain();
    timer.tick();
    expect(sink.chunks[before]).toBe(': ping\n\n');
  });

  it('runs without a heartbeat when asked', () => {
    const sink = fakeSink();
    const timer = fakeTimer();
    const stream = openSse(sink, { heartbeatMs: 0, startTimer: timer.start });
    timer.tick();
    expect(sink.chunks).toHaveLength(1);
    stream.close();
    expect(timer.stopped).toBe(false);
    expect(sink.ended).toBe(true);
  });

  it('writes nothing once closed, and closing twice is not an error', () => {
    const sink = fakeSink();
    const stream = openSse(sink, { startTimer: fakeTimer().start });
    stream.close();
    stream.close();
    expect(stream.closed).toBe(true);
    expect(stream.send('turn', {})).toBe(false);
    expect(stream.comment('x')).toBe(false);
    expect(sink.chunks).toHaveLength(1);
  });

  it('uses a real unreffed timer when none is injected', () => {
    const sink = fakeSink();
    const stream = openSse(sink, { heartbeatMs: 3_600_000 });
    stream.send('turn', undefined);
    expect(sink.chunks[1]).toBe('id: 1\nevent: turn\ndata: null\n\n');
    stream.close();
    expect(sink.ended).toBe(true);
  });
});
