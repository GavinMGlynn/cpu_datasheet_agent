import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EventEmitter } from 'node:events';

import { DEFAULT_PORT } from './server/server.js';

import { USAGE, main, parseWebCli, serveWeb, untilSignal, type ServeResult } from './cli.js';

let root: string;
let running: ServeResult | undefined;

/** An account on the running server, and the headers a browser would send. */
function signedIn(server: ServeResult): Record<string, string> {
  const accounts = server.auth.store.accounts;
  const account =
    accounts.byUsername('tester') ?? accounts.create({ username: 'tester', role: 'admin' });
  const issued = server.auth.signInAs(account);
  return { cookie: `chip_session=${issued.cookie}`, 'x-chip-token': issued.csrf };
}

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
        '--snapshot',
        '/tmp/snapshot.html',
        '--source',
        'eval-2026-09-11',
      ]),
    ).toStrictEqual({
      port: 8080,
      host: '0.0.0.0',
      dataDir: '/tmp/data',
      databaseFile: '/tmp/chip.sqlite',
      uiDir: '/tmp/ui',
      resultsDir: '/tmp/results',
      snapshot: '/tmp/snapshot.html',
      source: 'eval-2026-09-11',
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
    expect(() => parseWebCli(['--snapshot'])).toThrow(/needs a value/u);
    expect(() => parseWebCli(['--source', ''])).toThrow(/needs a value/u);
  });
});

describe('serveWeb', () => {
  it('starts a server and prints where to open it', async () => {
    const lines: string[] = [];
    running = await serveWeb(
      { help: false, port: 0, dataDir: path.join(root, 'data'), uiDir: path.join(root, 'ui') },
      { DATA_DIR: path.join(root, 'data'), LOG_LEVEL: 'error' },
      (line) => lines.push(line),
    );
    expect(running.url).toBe(running.server.url);
    expect(running.url).not.toContain('token');
    expect(lines[0]).toContain('chip-web listening on http://127.0.0.1:');
    // Nothing can sign in yet, and it says so rather than leaving a person
    // at a sign-in page no password will get past (20G.3).
    expect(lines.join(' ')).toContain('no accounts yet');
    const ping = await fetch(`${running.server.url}/api/ping`);
    expect(await ping.json()).toMatchObject({ ok: true, signedInAs: null });
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
      },
      { DATA_DIR: path.join(root, 'data'), LOG_LEVEL: 'error' },
      (line) => lines.push(line),
    );
    const sources = await fetch(`${running.server.url}/api/sources`, {
      headers: signedIn(running),
    });
    expect(JSON.stringify(await sources.json())).toContain('elsewhere.sqlite');
  });

  it('says nothing about accounts once there is one', async () => {
    const lines: string[] = [];
    const dataDir = path.join(root, 'data');
    running = await serveWeb(
      { help: false, port: 0, dataDir },
      { DATA_DIR: dataDir, LOG_LEVEL: 'error' },
      (line) => lines.push(line),
    );
    running.auth.store.accounts.create({ username: 'gavin', role: 'admin' });
    await running.close();
    const second: string[] = [];
    running = await serveWeb(
      { help: false, port: 0, dataDir },
      { DATA_DIR: dataDir, LOG_LEVEL: 'error' },
      (line) => second.push(line),
    );
    expect(second.join(' ')).not.toContain('no accounts yet');
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

describe('main --snapshot', () => {
  it('writes the file and stops, without ever binding a port', async () => {
    const lines: string[] = [];
    const file = path.join(root, 'out', 'snapshot.html');
    const code = await main(['--snapshot', file, '--data', path.join(root, 'data')], {
      env: { DATA_DIR: path.join(root, 'data'), LOG_LEVEL: 'error' },
      out: (line) => lines.push(line),
    });
    expect(code).toBe(0);
    expect(lines[0]).toContain(`snapshot written to ${file}`);
    expect(lines[1]).toContain('no credentials');
    const html = await readFile(file, 'utf8');
    expect(html).toContain('chip datasheet agent');
    expect(lines.some((line) => line.includes('listening'))).toBe(false);
  });

  it('reads the database it is pointed at, and says so when there is none', async () => {
    const lines: string[] = [];
    await expect(
      main(
        [
          '--snapshot',
          path.join(root, 'snapshot.html'),
          '--data',
          path.join(root, 'data'),
          '--source',
          'nowhere',
        ],
        {
          env: { DATA_DIR: path.join(root, 'data'), LOG_LEVEL: 'error' },
          out: (line) => lines.push(line),
        },
      ),
    ).rejects.toThrow(expect.objectContaining({ code: 'WEB_SOURCE_NOT_FOUND' }));
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
        if (line.startsWith('chip-web listening')) {
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
        if (line.startsWith('chip-web listening')) {
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
        if (line.startsWith('chip-web listening')) {
          stop();
        }
      },
      until,
    });
    await finished;
    expect(lines[0]).toContain('not the loopback interface');
  });
});
