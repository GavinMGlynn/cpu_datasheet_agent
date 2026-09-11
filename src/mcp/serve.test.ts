import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { serveMcpStdio } from './serve.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'serve-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('serveMcpStdio', () => {
  it('serves the tool surface until the session ends', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    let stop = (): void => {
      throw new Error('not started');
    };
    const until = new Promise<void>((resolve) => {
      stop = resolve;
    });

    const serving = serveMcpStdio({
      env: { DATA_DIR: root, LOG_LEVEL: 'error' },
      transport: serverTransport,
      until,
    });

    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toContain('get_part');

    const result = await client.callTool({ name: 'get_part', arguments: { mpn: 'TPS54331DR' } });
    expect((result as unknown as { structuredContent: { part: null } }).structuredContent).toEqual({
      part: null,
    });

    await client.close();
    stop();
    await expect(serving).resolves.toBeUndefined();
  }, 30_000);

  it('stops on a signal when nothing else says when to stop', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const serving = serveMcpStdio({
      env: { DATA_DIR: root, LOG_LEVEL: 'error' },
      transport: serverTransport,
    });

    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientTransport);
    await client.close();
    process.emit('SIGINT');

    await expect(serving).resolves.toBeUndefined();
  }, 30_000);

  it('reports a transport error to stderr without ending the session', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const lines: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });
    let stop = (): void => {
      throw new Error('not started');
    };
    const until = new Promise<void>((resolve) => {
      stop = resolve;
    });

    try {
      const serving = serveMcpStdio({
        env: { DATA_DIR: root, LOG_LEVEL: 'error' },
        transport: serverTransport,
        until,
      });
      const client = new Client({ name: 'test-client', version: '1.0.0' });
      await client.connect(clientTransport);

      // The transport reporting trouble is not the session ending.
      serverTransport.onerror?.(new Error('the pipe hiccuped'));
      expect((await client.listTools()).tools.length).toBeGreaterThan(0);

      await client.close();
      stop();
      await serving;
    } finally {
      spy.mockRestore();
    }

    const reported = lines.find((line) => line.includes('mcp transport error'));
    expect(reported).toContain('the pipe hiccuped');
  }, 30_000);

  it('reads the process environment and serves this process\u2019s stdio by default', async () => {
    const previous = process.env.DATA_DIR;
    process.env.DATA_DIR = root;
    try {
      // Nothing is sent, so the transport opens and closes without a byte
      // crossing it; what is under test is that the defaults are the process
      // itself rather than something a caller has to supply.
      await expect(serveMcpStdio({ until: Promise.resolve() })).resolves.toBeUndefined();
    } finally {
      if (previous === undefined) {
        delete process.env.DATA_DIR;
      } else {
        process.env.DATA_DIR = previous;
      }
    }
  }, 30_000);

  it('fails loudly when the environment is not configured', async () => {
    await expect(
      serveMcpStdio({ env: { DATA_DIR: root, LOG_LEVEL: 'chatty' }, until: Promise.resolve() }),
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
  }, 30_000);
});
