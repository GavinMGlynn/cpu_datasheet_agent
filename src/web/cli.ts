import { ChipAgentError, describeError } from '../errors.js';
import { elementAt } from '../util/array.js';
import { DEFAULT_HOST, DEFAULT_PORT, startWebServer, type RunningServer } from './server/server.js';
import { bindWarning } from './server/security.js';
import { createWeb, type WebOptions } from './create.js';
import type { AuthService } from '../auth/service.js';
import { writeSnapshot } from './snapshot/write.js';

export class WebCliError extends ChipAgentError {}

export const USAGE = `usage:
  chip-web [options]

options:
  --port <n>        port to listen on (default ${String(DEFAULT_PORT)})
  --host <address>  interface to bind (default ${DEFAULT_HOST}; anything else is announced)
  --data <dir>      data directory: the store, the cache, the ledger
  --db <file>       the live store, if it is not <data>/chip.sqlite
  --ui <dir>        the built front end, if it is not dist/ui
  --results <dir>   evaluation results (default eval/results)
  --snapshot <file> write a shareable snapshot and exit, instead of serving
  --source <id>     which database the snapshot reads (default live)
  --help            print this
`;

export interface WebCliOptions {
  readonly port?: number;
  readonly host?: string;
  readonly dataDir?: string;
  readonly databaseFile?: string;
  readonly uiDir?: string;
  readonly resultsDir?: string;
  /** Write a snapshot to this file and exit. */
  readonly snapshot?: string;
  /** The database a snapshot reads. */
  readonly source?: string;
  readonly help: boolean;
}

function integer(value: string | undefined, flag: string): number {
  const parsed = Number(value);
  if (value === undefined || !Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new WebCliError(
      'WEB_CLI_USAGE',
      `${flag} needs a port number, received ${String(value)}`,
    );
  }
  return parsed;
}

function text(value: string | undefined, flag: string): string {
  if (value === undefined || value === '') {
    throw new WebCliError('WEB_CLI_USAGE', `${flag} needs a value`);
  }
  return value;
}

export function parseWebCli(argv: readonly string[]): WebCliOptions {
  let options: WebCliOptions = { help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = elementAt(argv, index);
    const value = argv[index + 1];
    switch (flag) {
      case '--help':
      case '-h':
        options = { ...options, help: true };
        break;
      case '--port':
        options = { ...options, port: integer(value, '--port') };
        index += 1;
        break;
      case '--host':
        options = { ...options, host: text(value, '--host') };
        index += 1;
        break;
      case '--data':
        options = { ...options, dataDir: text(value, '--data') };
        index += 1;
        break;
      case '--db':
        options = { ...options, databaseFile: text(value, '--db') };
        index += 1;
        break;
      case '--ui':
        options = { ...options, uiDir: text(value, '--ui') };
        index += 1;
        break;
      case '--results':
        options = { ...options, resultsDir: text(value, '--results') };
        index += 1;
        break;
      case '--snapshot':
        options = { ...options, snapshot: text(value, '--snapshot') };
        index += 1;
        break;
      case '--source':
        options = { ...options, source: text(value, '--source') };
        index += 1;
        break;
      default:
        throw new WebCliError('WEB_CLI_USAGE', `unknown option ${flag}`);
    }
  }
  return options;
}

export interface ServeResult {
  readonly server: RunningServer;
  /** The address to open. Signing in happens on the page. */
  readonly url: string;
  /** The running server's accounts and sessions, for whoever started it. */
  readonly auth: AuthService;
  close(): Promise<void>;
}

function webOptions(options: WebCliOptions, env: NodeJS.ProcessEnv): WebOptions {
  return {
    env,
    ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
    ...(options.databaseFile === undefined ? {} : { databaseFile: options.databaseFile }),
    ...(options.uiDir === undefined ? {} : { uiDir: options.uiDir }),
    ...(options.resultsDir === undefined ? {} : { resultsDir: options.resultsDir }),
    ...(options.port === undefined ? {} : { port: options.port }),
    ...(options.host === undefined ? {} : { host: options.host }),
  };
}

/**
 * Starts the site and returns how to reach it.
 *
 * The address it prints is just the address: signing in is a username and a
 * password on the page, against an account in `auth.sqlite` (D75).
 */
export async function serveWeb(
  options: WebCliOptions,
  env: NodeJS.ProcessEnv,
  out: (line: string) => void,
): Promise<ServeResult> {
  const parts = await createWeb(webOptions(options, env));
  const server = await startWebServer({
    app: parts.app,
    ...(options.port === undefined ? {} : { port: options.port }),
    ...(options.host === undefined ? {} : { host: options.host }),
    onWarning: (warning) => {
      out(`warning: ${warning}`);
    },
  });
  out(`chip-web listening on ${server.url}`);
  if (parts.auth.accounts() === 0) {
    // Nothing can sign in yet, and the sign-in page says the same thing. A
    // default account with a known password would be worse than no account.
    out('no accounts yet: create one with `npx tsx bin/chip-auth.ts add <name> --role admin`');
  }
  return {
    server,
    url: server.url,
    auth: parts.auth,
    async close() {
      await server.close();
      parts.close();
    },
  };
}

export interface WebMainDeps {
  readonly env: NodeJS.ProcessEnv;
  readonly out: (line: string) => void;
  /** Resolves when the server should stop. Defaults to the first interrupt. */
  readonly until?: Promise<void>;
  /** Where interrupts come from. Defaults to this process. */
  readonly signals?: NodeJS.EventEmitter;
}

/** Resolves on the first SIGINT or SIGTERM. */
export function untilSignal(source: NodeJS.EventEmitter): Promise<void> {
  return new Promise<void>((resolve) => {
    const stop = (): void => {
      resolve();
    };
    source.once('SIGINT', stop);
    source.once('SIGTERM', stop);
  });
}

export async function main(argv: readonly string[], deps: WebMainDeps): Promise<number> {
  let options: WebCliOptions;
  try {
    options = parseWebCli(argv);
  } catch (error) {
    deps.out(describeError(error).message);
    deps.out(USAGE);
    return 2;
  }
  if (options.help) {
    deps.out(USAGE);
    return 0;
  }
  if (options.snapshot !== undefined) {
    const written = await writeSnapshot(
      options.snapshot,
      webOptions(options, deps.env),
      options.source === undefined ? {} : { source: options.source },
    );
    deps.out(`snapshot written to ${written.file} (${String(written.bytes)} bytes)`);
    deps.out('it holds no credentials, no datasheet text and no distributor payloads.');
    return 0;
  }
  const warning = bindWarning(options.host ?? DEFAULT_HOST);
  if (warning !== undefined) {
    deps.out(`warning: ${warning}`);
  }
  const running = await serveWeb(options, deps.env, deps.out);
  const signals = deps.signals ?? process;
  await (deps.until ?? untilSignal(signals));
  await running.close();
  deps.out('chip-web stopped');
  return 0;
}
