import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';

import type { ToolContext, ToolRegistry } from '../tools/index.js';
import { toCallResult, toErrorResult } from './result.js';
import { objectInput, SERVER_NAME, SERVER_VERSION } from './server.js';

/**
 * The same registry as an in-process server for the agent runner.
 *
 * One implementation, two thin adapters: the tool list, the schemas and the
 * ledger records are identical whether a call arrives over stdio or from the
 * runner in this process. A test asserts the two adapters expose the same
 * names, because "identical" is the whole claim.
 *
 * The Agent SDK takes a raw shape rather than a schema, so what it advertises
 * is the shape of each input; the registry still parses every call against
 * the strict schema, which is where an unknown key is refused.
 */
export type SdkTool = ReturnType<typeof tool>;

/**
 * Every registry tool as an Agent SDK tool definition.
 *
 * Exposed on its own so a test can hold the definitions and call their
 * handlers. The server they go into cannot be driven by an MCP client of a
 * different major line, and the thing worth proving is that each tool is
 * present and behaves, not that the SDK can assemble a server.
 *
 * `parentId` is the ledger entry every call made through these tools hangs
 * under. The agent runner passes its run's entry, which is what makes the
 * calls of one run countable among the calls of a batch.
 */
export function sdkTools(
  registry: ToolRegistry,
  context: ToolContext,
  parentId?: string,
): SdkTool[] {
  return registry.list().map((definition) =>
    tool(
      definition.name,
      definition.description,
      objectInput(definition.name, definition.input).shape,
      async (args: unknown) => {
        try {
          return toCallResult(
            definition,
            await registry.call(definition.name, args, context, parentId),
          );
        } catch (error) {
          return toErrorResult(error);
        }
      },
      { annotations: definition.annotations },
    ),
  );
}

export function createInProcessServer(
  registry: ToolRegistry,
  context: ToolContext,
  parentId?: string,
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
    tools: sdkTools(registry, context, parentId),
  });
}
