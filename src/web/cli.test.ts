import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EventEmitter } from 'node:events';

import { DEFAULT_PORT } from './server/server.js';

import { USAGE, main, parseWebCli, serveWeb, untilSignal, type ServeResult } from './cli.js';

let root: string;
let running: ServeResult | undefined;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'chip-web-cli-'));
});

afterEach(async () => {
  await running?.close();
  running = undefined;
  await rm(root, { recursive: true, force: true });
});

describe('parseWebCli', () => {
  it('reads every flag', () => {
    expect(
      parseWebCli([
        '--port',
        '8080',
        '--host',
        '0.0.0.0',
        '--data',
        '/tmp/data',
        '--db',
        '/tmp/chip.sqlite',
        '--ui',
        '/tmp/ui',
        '--results',
        '/tmp/results',
        '--token',
        'abc',
      ]),
    ).toStrictEqual({
      port: 8080,
      host: '0.0.0.0',
      dataDir: '/tmp/data',
      databaseFile: '/tmp/chip.sqlite',
      uiDir: '/tmp/ui',
      resultsDir: '/tmp/results',
      token: 'abc',
      help: false,
    });
  });

  it('defaults to nothing but help being off', () => {
    expect(parseWebCli([])).toStrictEqual({ help: false });
  });

  it('takes help either way round', () => {
    expect(parseWebCli(['--help']).help).toBe(true);
    expect(parseWebCli(['-h']).help).toBe(true);
  });

  it('refuses a port that is not one', () => {
    for (const argv of [['--port'], ['--port', 'eighty'], ['--port', '-1'], ['--port', '99999']]) {
      expect(() => parseWebCli(argv)).toThrow(expect.objectContaining({ code: 'WEB_CLI_USAGE' }));
    }
  });

  it('refuses a flag with no value and a flag it does not know', () => {
    expect(() => parseWebCli(['--host'])).toThrow(/needs a value/u);
    expect(() => parseWebCli(['--data', ''])).toThrow(/needs a value/u);
    expect(() => parseWebCli(['--nonsense'])).toThrow(/unknown option/u);
  });
});

describe('serveWeb', () => {
  it('starts a server and prints where to open it, token and all', async () => {
    const lines: string[] = [];
    running = await serveWeb(
      { help: false, port: 0, dataDir: path.join(root, 'data'), uiDir: path.join(root, 'ui') },
      { DATA_DIR: path.join(root, 'data'), LOG_LEVEL: 'error' },
      (line) => lines.push(line),
    );
    expect(running.url).toContain(`?token=${running.token}`);
    expect(lines[0]).toContain('chip-web listening on http://127.0.0.1:');
    const ping = await fetch(`${running.server.url}/api/ping`);
    expect(await ping.json()).toMatchObject({ ok: true, authenticated: false });
  });

  it('takes nothing but a port, and finds the rest from the environment', async () => {
    const lines: string[] = [];
    running = await serveWeb(
      { help: false, port: 0 },
      { DATA_DIR: path.join(root, 'data'), LOG_LEVEL: 'error' },
      (line) => lines.push(line),
    );
    const ping = await fetch(`${running.server.url}/api/ping`);
    expect(ping.status).toBe(200);
  });

  it('falls back to the project port when none is given', async () => {
    // Either outcome proves the default was used: it bound 5174, or 5174 was
    // already taken. Nothing else in this suite binds a fixed port.
    try {
      running = await serveWeb(
        { help: false, dataDir: path.join(root, 'data') },
        { DATA_DIR: path.join(root, 'data'), LOG_LEVEL: 'error' },
        () => undefined,
      );
      expect(running.server.port).toBe(DEFAULT_PORT);
    } catch (error) {
      expect(error).toMatchObject({ code: 'WEB_PORT_IN_USE' });
    }
  });

  it('takes every option it is given', async () => {
    const lines: string[] = [];
    running = await serveWeb(
      {
        help: false,
        port: 0,
        host: '127.0.0.1',
        dataDir: path.join(root, 'data'),
        databaseFile: path.join(root, 'data', 'elsewhere.sqlite'),
        uiDir: path.join(root, 'ui'),
        resultsDir: path.join(root, 'results'),
        token: 'a-token-worth-twenty-chars',
      },
      { DATA_DIR: path.join(root, 'data'), LOG_LEVEL: 'error' },
      (line) => lines.push(line),
    );
    expect(running.token).toBe('a-token-worth-twenty-chars');
    const sources = await fetch(`${running.server.url}/api/sources`, {
      headers: { authorization: 'Bearer a-token-worth-twenty-chars' },
    });
    expect(JSON.stringify(await sources.json())).toContain('elsewhere.sqlite');
  });

  it('announces a bind beyond the loopback interface', async () => {
    const lines: string[] = [];
    running = await serveWeb(
      { help: false, port: 0, host: '0.0.0.0', dataDir: path.join(root, 'data') },
      { DATA_DIR: path.join(root, 'data'), LOG_LEVEL: 'error' },
      (line) => lines.push(line),
    );
    expect(lines.some((line) => line.startsWith('warning:'))).toBe(true);
  });
});

describe('untilSignal', () => {
  it('resolves on the first interrupt, from whichever signal arrives', async () => {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      const source = new EventEmitter();
      const waited = untilSignal(source);
      source.emit(signal);
      await expect(waited).resolves.toBeUndefined();
    }
  });
});

describe('main', () => {
  it('prints usage and stops for --help', async () => {
    const lines: string[] = [];
    expect(await main(['--help'], { env: {}, out: (line) => lines.push(line) })).toBe(0);
    expect(lines[0]).toBe(USAGE);
  });

  it('reports a bad flag, prints usage, and fails', async () => {
    const lines: string[] = [];
    expect(await main(['--nope'], { env: {}, out: (line) => lines.push(line) })).toBe(2);
    expect(lines[0]).toContain('unknown option');
    expect(lines[1]).toBe(USAGE);
  });

  it('serves until it is told to stop', async () => {
    const lines: string[] = [];
    let stop = (): void => undefined;
    const until = new Promise<void>((resolve) => {
      stop = resolve;
    });
    const finished = main(['--port', '0', '--data', path.join(root, 'data')], {
      env: { DATA_DIR: path.join(root, 'data'), LOG_LEVEL: 'error' },
      out: (line) => {
        lines.push(line);
        if (line.startsWith('open ')) {
          stop();
        }
      },
      until,
    });
    expect(await finished).toBe(0);
    expect(lines.at(-1)).toBe('chip-web stopped');
  });

  it('stops on an interrupt when it is given no other signal', async () => {
    const signals = new EventEmitter();
    const lines: string[] = [];
    const finished = main(['--port', '0', '--data', path.join(root, 'data')], {
      env: { DATA_DIR: path.join(root, 'data'), LOG_LEVEL: 'error' },
      out: (line) => {
        lines.push(line);
        if (line.startsWith('open ')) {
          // After the current turn: main subscribes to the signal only once
          // serveWeb has returned, which is after this line is printed.
          setTimeout(() => signals.emit('SIGINT'), 0);
        }
      },
      signals,
    });
    expect(await finished).toBe(0);
    expect(lines.at(-1)).toBe('chip-web stopped');
  });

  it('warns before it starts when told to bind wide', async () => {
    const lines: string[] = [];
    let stop = (): void => undefined;
    const until = new Promise<void>((resolve) => {
      stop = resolve;
    });
    const finished = main(['--port', '0', '--host', '0.0.0.0', '--data', path.join(root, 'data')], {
      env: { DATA_DIR: path.join(root, 'data'), LOG_LEVEL: 'error' },
      out: (line) => {
        lines.push(line);
        if (line.startsWith('open ')) {
          stop();
        }
      },
      until,
    });
    await finished;
    expect(lines[0]).toContain('not the loopback interface');
  });
});
