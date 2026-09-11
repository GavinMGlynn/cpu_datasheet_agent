import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createHarness, type TestHarness } from '../../test/helpers/tool-context.js';
import { ToolRegistry, buildRegistry, defineTool } from '../tools/index.js';
import { createInProcessServer, sdkTools, type SdkTool } from './sdk.js';
import { SERVER_NAME } from './server.js';

/**
 * The in-process server, driven the way the harness drives it.
 *
 * The Agent SDK's server is built on the 1.x MCP SDK it bundles, and this
 * project's client is the 2.x line; a v2 client speaks to it happily. What
 * does not survive the trip is a schema the bundled SDK cannot turn into
 * JSON Schema — a Zod record — and one such tool empties the whole tool
 * list rather than its own entry (D48). Listing the tools over a real
 * connection is the only thing that catches it, and calling the handlers
 * directly does not.
 */
async function connectInProcess(
  registry: ToolRegistry = buildRegistry(),
): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = createInProcessServer(registry, harness.context);
  const instance = server.instance as unknown as {
    connect: (transport: unknown) => Promise<void>;
    close: () => Promise<void>;
  };
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'in-process-test', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), instance.connect(serverTransport)]);
  return {
    client,
    close: async (): Promise<void> => {
      await client.close();
      await instance.close();
    },
  };
}

interface CalledResult {
  content: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

let harness: TestHarness;

function tools(registry: ToolRegistry = buildRegistry()): SdkTool[] {
  return sdkTools(registry, harness.context);
}

async function run(name: string, args: Record<string, unknown>): Promise<CalledResult> {
  const found = tools().find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(`no tool named ${name}`);
  }
  return (await found.handler(args, {})) as unknown as CalledResult;
}

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.close();
});

describe('the in-process server', () => {
  it('is the same surface as the stdio server, tool for tool', () => {
    const registry = buildRegistry();
    expect(tools(registry).map((tool) => tool.name)).toEqual([...registry.names()]);
  });

  it('names itself the same way, so one server is not mistaken for another', () => {
    const server = createInProcessServer(buildRegistry(), harness.context);
    expect(server.name).toBe(SERVER_NAME);
    expect(server.type).toBe('sdk');
  });

  it('lists every tool over a connection, with a schema the harness can convert', async () => {
    const registry = buildRegistry();
    const { client, close } = await connectInProcess(registry);

    try {
      const { tools: listed } = await client.listTools();

      expect(listed.map((tool) => tool.name)).toEqual([...registry.names()]);
      for (const tool of listed) {
        expect(tool.inputSchema).toMatchObject({ type: 'object' });
      }
    } finally {
      await close();
    }
  });

  it('answers a call over that connection', async () => {
    const { client, close } = await connectInProcess();

    try {
      const result = (await client.callTool({
        name: 'cache_stats',
        arguments: {},
      })) as unknown as CalledResult;

      expect(result.structuredContent).toMatchObject({ hits: 0, misses: 0 });
    } finally {
      await close();
    }
  });

  it('carries each tool’s description and annotations', () => {
    const getPart = tools().find((tool) => tool.name === 'get_part');
    expect(getPart?.description).toContain('stored part');
    expect(getPart?.annotations?.readOnlyHint).toBe(true);
    expect(tools().find((tool) => tool.name === 'upsert_part')?.annotations?.destructiveHint).toBe(
      true,
    );
  });

  it('advertises each tool’s input fields', () => {
    const readPages = tools().find((tool) => tool.name === 'read_pages');
    expect(Object.keys(readPages?.inputSchema ?? {}).sort()).toEqual(['pages', 'sha256']);
  });

  it('runs a tool and returns its result', async () => {
    const result = await run('cache_stats', {});

    expect(result.structuredContent).toEqual({
      hits: 0,
      misses: 0,
      expired: 0,
      forced: 0,
      joined: 0,
    });
  });

  it('returns a failure as an error result carrying the code', async () => {
    const result = await run('pdf_info', { sha256: 'a'.repeat(64) });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? '{}')).toMatchObject({ code: 'TOOL_NOT_FOUND' });
  });

  it('rejects input the tool does not accept, as an error result', async () => {
    const result = await run('get_part', { mpn: '' });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? '{}')).toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('records its calls in the same ledger', async () => {
    await run('cache_stats', {});

    const records = await harness.ledgerRecords();
    expect(records.map((record) => record.tool)).toEqual(['cache_stats']);
  });

  it('refuses a tool whose input is not an object, as the other adapter does', () => {
    const registry = new ToolRegistry().add(
      defineTool({
        name: 'odd',
        description: 'Takes a bare string, which no MCP client could call.',
        input: z.string(),
        output: z.strictObject({}),
        annotations: { readOnlyHint: true, destructiveHint: false },
        handler: () => Promise.resolve({}),
      }),
    );
    expect(() => createInProcessServer(registry, harness.context)).toThrow(/must take an object/);
  });
});
