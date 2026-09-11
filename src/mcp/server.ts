import { McpServer } from '@modelcontextprotocol/server';
import type { z } from 'zod';

import { ToolError, type ToolContext, type ToolRegistry } from '../tools/index.js';
import { isObjectSchema, toCallResult, toErrorResult, type CallResult } from './result.js';

/**
 * The schema type the SDK's registration signature names: an object that
 * strips unknown keys.
 *
 * Ours are strict, and a strict object works exactly as well at runtime —
 * it produces `additionalProperties: false` in the advertised JSON Schema and
 * the SDK rejects an unrecognised argument with the key in the message.
 * Advertising the loose form instead would have the transport quietly drop an
 * argument the tool never agreed to ignore, which is the coercion this
 * project refuses everywhere else. Hence one cast, here, restating that a
 * stricter schema is a valid schema.
 */
type Advertised = z.ZodObject;

function advertise(schema: z.ZodObject): Advertised {
  return schema;
}

export const SERVER_NAME = 'chip-datasheet-agent';
export const SERVER_VERSION = '0.1.0';

/**
 * The input shape a tool advertises.
 *
 * Both SDKs want an object schema. Every tool here has one; a tool that did
 * not could not be described to a client at all, so it is refused at
 * registration rather than at call time.
 */
export function objectInput(name: string, schema: z.ZodType): z.ZodObject {
  if (!isObjectSchema(schema)) {
    throw new ToolError('TOOL_INPUT_NOT_OBJECT', `${name} must take an object, and does not`, {
      details: { tool: name },
    });
  }
  return schema;
}

/**
 * Every tool in the registry, registered on one MCP server.
 *
 * A thrown error becomes an error result rather than a transport failure:
 * the model is meant to read the code and decide what to do, which it cannot
 * do with a broken connection.
 */
export function createMcpServer(registry: ToolRegistry, context: ToolContext): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );
  for (const definition of registry.list()) {
    const input = objectInput(definition.name, definition.input);
    server.registerTool(
      definition.name,
      {
        description: definition.description,
        inputSchema: advertise(input),
        // A union output (the spending tools) is not an object schema, so it
        // is carried as text rather than described as one.
        ...(isObjectSchema(definition.output)
          ? { outputSchema: advertise(definition.output) }
          : {}),
        annotations: {
          readOnlyHint: definition.annotations.readOnlyHint,
          destructiveHint: definition.annotations.destructiveHint,
        },
      },
      async (args: unknown): Promise<CallResult> => {
        try {
          return toCallResult(definition, await registry.call(definition.name, args, context));
        } catch (error) {
          return toErrorResult(error);
        }
      },
    );
  }
  return server;
}
