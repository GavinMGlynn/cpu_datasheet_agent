import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';

import { WebError } from './errors.js';
import { bindWarning } from './security.js';

export type RequestListener = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<void> | void;

export interface StartOptions {
  readonly app: RequestListener;
  /** Interface to bind. Defaults to the loopback address. */
  readonly host?: string;
  /** Port to bind. Zero asks the operating system for a free one. */
  readonly port?: number;
  /** Receives the warning when the bind address is not loopback (D67). */
  readonly onWarning?: (warning: string) => void;
}

export interface RunningServer {
  readonly host: string;
  readonly port: number;
  /** The address to open, with the loopback address spelled the way a browser wants it. */
  readonly url: string;
  readonly server: Server;
  /** Connections currently open, including event streams. */
  openConnections(): number;
  close(): Promise<void>;
}

export const DEFAULT_PORT = 5174;
export const DEFAULT_HOST = '127.0.0.1';

export interface BindTarget {
  readonly host: string;
  readonly port: number;
}

/** The address to bind, with this project's defaults filled in. */
export function bindTarget(options: Pick<StartOptions, 'host' | 'port'>): BindTarget {
  return { host: options.host ?? DEFAULT_HOST, port: options.port ?? DEFAULT_PORT };
}

export function urlFor(host: string, port: number): string {
  const name = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
  const bracketed = name.includes(':') && !name.startsWith('[') ? `[${name}]` : name;
  return `http://${bracketed}:${String(port)}`;
}

/**
 * Binds the socket and returns the running server.
 *
 * Shutdown destroys open connections rather than waiting for them. An event
 * stream is a connection that by design never ends, so a polite
 * `server.close()` on its own waits for ever, and a Ctrl-C that does nothing
 * is worse than an abrupt one.
 */
export async function startWebServer(options: StartOptions): Promise<RunningServer> {
  const { host, port } = bindTarget(options);
  const warning = bindWarning(host);
  if (warning !== undefined) {
    options.onWarning?.(warning);
  }

  const connections = new Set<Duplex>();
  const server = createServer((request, response) => {
    void options.app(request, response);
  });
  server.on('connection', (socket: Duplex) => {
    connections.add(socket);
    socket.on('close', () => connections.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      reject(
        new WebError(
          500,
          error.code === 'EADDRINUSE' ? 'WEB_PORT_IN_USE' : 'WEB_LISTEN_FAILED',
          error.code === 'EADDRINUSE'
            ? `port ${String(port)} is already in use`
            : `cannot listen on ${host}:${String(port)}: ${error.message}`,
          { cause: error, details: { host, port } },
        ),
      );
    };
    server.once('error', onError);
    server.listen(port, host, () => {
      server.removeListener('error', onError);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  return {
    host,
    port: address.port,
    url: urlFor(host, address.port),
    server,
    openConnections: () => connections.size,
    async close() {
      for (const socket of connections) {
        socket.destroy();
      }
      connections.clear();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolve();
            return;
          }
          reject(error);
        });
      });
    },
  };
}
