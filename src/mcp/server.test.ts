import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { part } from '../../test/helpers/core-fixtures.js';
import { createHarness, type TestHarness } from '../../test/helpers/tool-context.js';
import { ToolError, ToolRegistry, buildRegistry, defineTool } from '../tools/index.js';
import { createMcpServer, objectInput, SERVER_NAME } from './server.js';

interface ToolResult {
  content: { type: string; text?: string; data?: string; mimeType?: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

let harness: TestHarness;
let client: Client;
let closeServer: () => Promise<void>;

async function connect(registry: ToolRegistry = buildRegistry()): Promise<void> {
  const server = createMcpServer(registry, harness.context);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  closeServer = async (): Promise<void> => {
    await client.close();
    await server.close();
  };
}

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as unknown as ToolResult;
}

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await closeServer();
  await harness.close();
});

describe('the stdio-ready server', () => {
  it('lists every tool with its description and annotations', async () => {
    await connect();

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([...buildRegistry().names()].sort());
    const getPart = tools.find((tool) => tool.name === 'get_part');
    expect(getPart?.description).toContain('stored part');
    expect(getPart?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((tool) => tool.name === 'upsert_part')?.annotations?.destructiveHint).toBe(
      true,
    );
  });

  it('advertises an input schema a client can validate against', async () => {
    await connect();

    const { tools } = await client.listTools();
    const schema = tools.find((tool) => tool.name === 'read_pages')?.inputSchema;

    expect(schema?.type).toBe('object');
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual(['pages', 'sha256']);
  });

  it('calls a tool and returns its result as text and structured content', async () => {
    await connect();

    const result = await callTool('cache_stats', {});

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      hits: 0,
      misses: 0,
      expired: 0,
      forced: 0,
      joined: 0,
    });
    expect(JSON.parse(result.content[0]?.text ?? '{}')).toEqual(result.structuredContent);
  });

  it('returns a rendered page as an image block', async () => {
    const { sha256 } = await harness.addDatasheet();
    await connect();

    const result = await callTool('render_page', { sha256, page: 1, dpi: 72 });

    expect(result.content[0]?.type).toBe('image');
    expect(result.content[0]?.mimeType).toBe('image/png');
    expect(result.content[1]?.text).toBe('page 1 at 72 dpi');
  });

  it('turns a tool failure into an error result carrying the code', async () => {
    await connect();

    const result = await callTool('pdf_info', { sha256: 'a'.repeat(64) });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? '{}')).toMatchObject({
      code: 'TOOL_NOT_FOUND',
    });
  });

  it('rejects input the advertised schema refuses, naming the field', async () => {
    await connect();

    const result = await callTool('get_part', { mpn: '' });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('mpn');
  });

  it('refuses an argument the tool does not take, rather than dropping it', async () => {
    await connect();

    const result = await callTool('get_part', { mpn: 'TPS54331DR', surprise: true });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('surprise');
  });

  it('advertises the strictness it enforces', async () => {
    await connect();
    const { tools } = await client.listTools();
    expect(tools.find((tool) => tool.name === 'get_part')?.inputSchema.additionalProperties).toBe(
      false,
    );
  });

  it('describes a failure that is not one of ours without losing it', async () => {
    const registry = new ToolRegistry().add(
      defineTool({
        name: 'boom',
        description: 'Throws something that is not a ChipAgentError.',
        input: z.strictObject({}),
        output: z.strictObject({}),
        annotations: { readOnlyHint: true, destructiveHint: false },
        handler: () => Promise.reject(new RangeError('out of range')),
      }),
    );
    await connect(registry);

    const result = await callTool('boom', {});

    expect(JSON.parse(result.content[0]?.text ?? '{}')).toMatchObject({
      code: 'UNKNOWN',
      message: 'RangeError: out of range',
    });
  });

  it('records every call in the ledger, whatever the transport', async () => {
    await connect();

    await callTool('upsert_part', { part: part() });
    await callTool('get_part', { mpn: 'TPS54331DR' });

    const records = await harness.ledgerRecords();
    expect(records.map((record) => record.tool)).toEqual(['upsert_part', 'get_part']);
  });

  it('writes nothing to stdout during a session', async () => {
    const written: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });
    try {
      await connect();
      await callTool('cache_stats', {});
      await callTool('pdf_info', { sha256: 'b'.repeat(64) });
    } finally {
      spy.mockRestore();
    }
    expect(written).toEqual([]);
  });

  it('refuses to advertise a tool that does not take an object', () => {
    expect(() => objectInput('odd', z.string())).toThrow(ToolError);
  });

  it('names itself so a client can tell which server it is talking to', async () => {
    await connect();
    expect(client.getServerVersion()?.name).toBe(SERVER_NAME);
  });
});
