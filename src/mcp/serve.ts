import { serveStdio } from '@modelcontextprotocol/server/stdio';
import type { Transport } from '@modelcontextprotocol/server';

import { loadConfig } from '../config.js';
import { createLogger } from '../log/index.js';
import { buildRegistry, createToolContext } from '../tools/index.js';
import { createMcpServer } from './server.js';

export interface ServeOptions {
  /** Where the process reads its configuration from. Defaults to the environment. */
  readonly env?: NodeJS.ProcessEnv;
  /** Transport to serve on. Defaults to this process's stdio. */
  readonly transport?: Transport;
  /**
   * Resolves when the server should stop. Defaults to the first of SIGINT,
   * SIGTERM, or stdin closing, which is how a client ends an stdio session.
   */
  readonly until?: Promise<void>;
}

function untilSignal(): Promise<void> {
  return new Promise<void>((resolve) => {
    const stop = (): void => {
      resolve();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    process.stdin.once('close', stop);
  });
}

/**
 * Runs the tool surface as an MCP server until the session ends.
 *
 * Every log line goes to stderr. stdout belongs to the protocol, so a stray
 * line there corrupts the session rather than being untidy (D09).
 */
export async function serveMcpStdio(options: ServeOptions = {}): Promise<void> {
  const config = loadConfig(options.env ?? process.env);
  const logger = createLogger({ level: config.logLevel, fields: { name: 'chip-mcp' } });
  const { context, db } = await createToolContext({ config });
  const registry = buildRegistry();
  logger.info('mcp server ready', {
    tools: registry.names().length,
    digikey: context.digikey !== undefined,
    mouser: context.mouser !== undefined,
  });

  const handle = serveStdio(() => createMcpServer(registry, context), {
    ...(options.transport === undefined ? {} : { transport: options.transport }),
    onerror: (error) => {
      logger.error('mcp transport error', { error: String(error) });
    },
  });

  try {
    await (options.until ?? untilSignal());
  } finally {
    await handle.close();
    db.close();
    logger.info('mcp server stopped', {});
  }
}
