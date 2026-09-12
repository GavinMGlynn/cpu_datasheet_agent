import { connect } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  bindTarget,
  startWebServer,
  urlFor,
  type RunningServer,
} from './server.js';

const running: RunningServer[] = [];

async function start(options: Parameters<typeof startWebServer>[0]): Promise<RunningServer> {
  const server = await startWebServer(options);
  running.push(server);
  return server;
}

const ok = (_request: unknown, response: { statusCode: number; end(body: string): void }): void => {
  response.statusCode = 200;
  response.end('served');
};

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close().catch(() => undefined)));
});

describe('bindTarget', () => {
  it('defaults to the loopback interface and the project port', () => {
    expect(bindTarget({})).toStrictEqual({ host: DEFAULT_HOST, port: DEFAULT_PORT });
  });

  it('takes what it is given', () => {
    expect(bindTarget({ host: '0.0.0.0', port: 8080 })).toStrictEqual({
      host: '0.0.0.0',
      port: 8080,
    });
  });
});

describe('urlFor', () => {
  it('turns a wildcard bind into an address a browser can open', () => {
    expect(urlFor('0.0.0.0', 5174)).toBe('http://localhost:5174');
    expect(urlFor('::', 5174)).toBe('http://localhost:5174');
  });

  it('brackets an IPv6 address', () => {
    expect(urlFor('::1', 5174)).toBe('http://[::1]:5174');
    expect(urlFor('[::1]', 5174)).toBe('http://[::1]:5174');
  });

  it('leaves an ordinary host alone', () => {
    expect(urlFor('127.0.0.1', 5174)).toBe('http://127.0.0.1:5174');
  });
});

describe('startWebServer', () => {
  it('serves requests and reports where it is listening', async () => {
    const server = await start({ app: ok, port: 0 });
    expect(server.port).toBeGreaterThan(0);
    expect(server.url).toBe(`http://127.0.0.1:${String(server.port)}`);
    const response = await fetch(`${server.url}/anything`);
    expect(await response.text()).toBe('served');
  });

  it('warns when it is told to listen beyond the loopback interface', async () => {
    const warnings: string[] = [];
    await start({ app: ok, host: '0.0.0.0', port: 0, onWarning: (line) => warnings.push(line) });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/runs that cost money/u);
  });

  it('binds wide without a warning listener', async () => {
    const server = await start({ app: ok, host: '0.0.0.0', port: 0 });
    expect(server.host).toBe('0.0.0.0');
  });

  it('says plainly that the port is taken', async () => {
    const first = await start({ app: ok, port: 0 });
    await expect(start({ app: ok, port: first.port })).rejects.toThrow(
      expect.objectContaining({ code: 'WEB_PORT_IN_USE' }),
    );
  });

  it('reports any other listen failure with the address it tried', async () => {
    await expect(start({ app: ok, host: '203.0.113.1', port: 0 })).rejects.toThrow(
      expect.objectContaining({ code: 'WEB_LISTEN_FAILED' }),
    );
  });

  it('destroys open connections on close, rather than waiting for them', async () => {
    const server = await start({ app: ok, port: 0 });
    const socket = connect(server.port, '127.0.0.1');
    await new Promise<void>((resolve) => {
      socket.once('connect', () => {
        resolve();
      });
    });
    expect(server.openConnections()).toBe(1);
    await server.close();
    expect(server.openConnections()).toBe(0);
  });

  it('forgets a connection the client closes', async () => {
    const server = await start({ app: ok, port: 0 });
    const socket = connect(server.port, '127.0.0.1');
    await new Promise<void>((resolve) => {
      socket.once('connect', () => {
        resolve();
      });
    });
    socket.destroy();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 25);
    });
    expect(server.openConnections()).toBe(0);
  });

  it('fails a second close, which is a caller error rather than a silent success', async () => {
    const server = await start({ app: ok, port: 0 });
    await server.close();
    await expect(server.close()).rejects.toThrow(/not running/u);
  });
});
