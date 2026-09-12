import path from 'node:path';

import { ROLES, Role, Username, type Account } from './account.js';
import { ChipAgentError, describeError } from '../errors.js';
import { MINIMUM_LENGTH, checkPassword, hashPassword } from './password.js';
import { createAuthStore, type AuthStore } from './store.js';
import { loadConfig } from '../config.js';
import { parseOrThrow } from '../core/validation-error.js';
import { elementAt } from '../util/array.js';
import { required } from '../util/present.js';

/**
 * Managing accounts from the terminal.
 *
 * There is no first account and no default password: the only way one exists
 * is that a person at this machine made it (20G.3). A password is read from
 * the terminal with the echo off, or from standard input for a script — never
 * from an argument, where it would sit in the shell history and in the output
 * of `ps` for everyone on the machine to read (20G.2).
 */

export class AuthCliError extends ChipAgentError {}

export const USAGE = `usage:
  chip-auth <command> [options]

commands:
  add <username> --role admin|viewer [--name "Full Name"]
  passwd <username>
  role <username> <admin|viewer>
  disable <username>
  enable <username>
  bind <username> --issuer <url> --subject <id>
  sessions <username>            list the sessions this account holds
  revoke <username>              end every session this account holds
  list

options:
  --data <dir>          data directory (default: DATA_DIR, then ./data)
  --auth <file>         identity database (default: <data>/auth.sqlite)
  --name <text>         display name, for add
  --password-stdin      read the password from standard input rather than the terminal
  --help                print this

a password is never taken from the command line: it is typed at the prompt,
or piped in with --password-stdin.
`;

export interface AuthCliOptions {
  readonly command?: string;
  readonly args: readonly string[];
  readonly dataDir?: string;
  readonly authFile?: string;
  readonly name?: string;
  readonly role?: string;
  readonly issuer?: string;
  readonly subject?: string;
  readonly passwordStdin: boolean;
  readonly help: boolean;
}

function value(next: string | undefined, flag: string): string {
  if (next === undefined || next === '') {
    throw new AuthCliError('AUTH_CLI_USAGE', `${flag} needs a value`);
  }
  return next;
}

export function parseAuthCli(argv: readonly string[]): AuthCliOptions {
  let options: AuthCliOptions = { args: [], passwordStdin: false, help: false };
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const flag = elementAt(argv, index);
    const next = argv[index + 1];
    switch (flag) {
      case '--help':
      case '-h':
        options = { ...options, help: true };
        break;
      case '--data':
        options = { ...options, dataDir: value(next, '--data') };
        index += 1;
        break;
      case '--auth':
        options = { ...options, authFile: value(next, '--auth') };
        index += 1;
        break;
      case '--name':
        options = { ...options, name: value(next, '--name') };
        index += 1;
        break;
      case '--role':
        options = { ...options, role: value(next, '--role') };
        index += 1;
        break;
      case '--issuer':
        options = { ...options, issuer: value(next, '--issuer') };
        index += 1;
        break;
      case '--subject':
        options = { ...options, subject: value(next, '--subject') };
        index += 1;
        break;
      case '--password-stdin':
        options = { ...options, passwordStdin: true };
        break;
      default:
        if (flag.startsWith('-')) {
          throw new AuthCliError('AUTH_CLI_USAGE', `unknown option ${flag}`);
        }
        positional.push(flag);
    }
  }
  const [command, ...rest] = positional;
  return { ...options, ...(command === undefined ? {} : { command }), args: rest };
}

export interface AuthCliDeps {
  readonly env: NodeJS.ProcessEnv;
  readonly out: (line: string) => void;
  /** Asks for a password without echoing it. */
  readonly askPassword: (prompt: string) => Promise<string>;
  /** Reads standard input to its end, for `--password-stdin`. */
  readonly readStdin: () => Promise<string>;
  readonly clock?: () => Date;
  /** Injected by the tests; the command opens the real one. */
  readonly openStore?: (file: string) => AuthStore;
}

function describe(account: Account): string {
  const identity = account.issuer === undefined ? '' : ` · signs in through ${account.issuer}`;
  return [
    account.username.padEnd(24),
    account.role.padEnd(7),
    account.hasPassword ? 'password' : 'no password',
    account.disabledAt === undefined ? '' : ' · disabled',
    identity,
  ].join(' ');
}

function find(store: AuthStore, username: string): Account {
  const account = store.accounts.byUsername(username);
  if (account === undefined) {
    throw new AuthCliError('AUTH_CLI_NO_ACCOUNT', `there is no account called ${username}`, {
      details: { username },
    });
  }
  return account;
}

/** Reads a password twice from the terminal, or once from standard input. */
async function readPassword(options: AuthCliOptions, deps: AuthCliDeps): Promise<string> {
  if (options.passwordStdin) {
    const piped = (await deps.readStdin()).replace(/\r?\n$/u, '');
    checkPassword(piped);
    return piped;
  }
  const first = await deps.askPassword(
    `password (at least ${String(MINIMUM_LENGTH)} characters): `,
  );
  checkPassword(first);
  const again = await deps.askPassword('again: ');
  if (first !== again) {
    throw new AuthCliError('AUTH_CLI_MISMATCH', 'those two passwords are not the same');
  }
  return first;
}

export async function runAuthCli(options: AuthCliOptions, deps: AuthCliDeps): Promise<number> {
  if (options.help || options.command === undefined) {
    deps.out(USAGE);
    return options.help ? 0 : 2;
  }
  const config = loadConfig(deps.env);
  const dataDir = options.dataDir ?? config.dataDir;
  const file = options.authFile ?? path.join(dataDir, 'auth.sqlite');
  // Whoever opened it closes it: a caller that handed one in (the tests, and
  // anything embedding this later) still wants it afterwards.
  const opened = deps.openStore === undefined;
  const store = opened
    ? createAuthStore(file)
    : required(deps.openStore, 'the injected store')(file);
  const now = (deps.clock ?? ((): Date => new Date()))().toISOString();
  try {
    switch (options.command) {
      case 'add': {
        const username = parseOrThrow(Username, elementAt(options.args, 0), 'username');
        const role = parseOrThrow(Role, options.role ?? 'viewer', 'role');
        const password = await readPassword(options, deps);
        const account = store.accounts.create(
          {
            username,
            role,
            passwordHash: await hashPassword(password),
            ...(options.name === undefined ? {} : { displayName: options.name }),
          },
          now,
        );
        deps.out(`added ${account.username} as ${account.role}`);
        return 0;
      }
      case 'passwd': {
        const account = find(store, elementAt(options.args, 0));
        const password = await readPassword(options, deps);
        store.accounts.setPassword(account.id, await hashPassword(password), now);
        const ended = store.sessions.removeForAccount(account.id);
        deps.out(`changed the password for ${account.username}; ${String(ended)} session(s) ended`);
        return 0;
      }
      case 'role': {
        const account = find(store, elementAt(options.args, 0));
        const role = parseOrThrow(Role, elementAt(options.args, 1), 'role');
        store.accounts.setRole(account.id, role, now);
        deps.out(`${account.username} is now ${role}`);
        return 0;
      }
      case 'disable':
      case 'enable': {
        const account = find(store, elementAt(options.args, 0));
        const disabled = options.command === 'disable';
        store.accounts.setDisabled(account.id, disabled, now);
        const ended = disabled ? store.sessions.removeForAccount(account.id) : 0;
        deps.out(
          `${account.username} is ${disabled ? 'disabled' : 'enabled'}${
            disabled ? `; ${String(ended)} session(s) ended` : ''
          }`,
        );
        return 0;
      }
      case 'bind': {
        const account = find(store, elementAt(options.args, 0));
        const issuer = value(options.issuer, '--issuer');
        const subject = value(options.subject, '--subject');
        store.accounts.bindIdentity(account.id, issuer, subject, now);
        deps.out(`${account.username} signs in through ${issuer}`);
        return 0;
      }
      case 'sessions': {
        const account = find(store, elementAt(options.args, 0));
        const sessions = store.sessions.forAccount(account.id);
        if (sessions.length === 0) {
          deps.out(`${account.username} has no sessions`);
          return 0;
        }
        for (const one of sessions) {
          deps.out(
            `${one.createdAt} · last seen ${one.lastSeenAt} · ${one.address ?? 'no address'} · ${
              one.userAgent ?? 'no user agent'
            }`,
          );
        }
        return 0;
      }
      case 'revoke': {
        const account = find(store, elementAt(options.args, 0));
        const ended = store.sessions.removeForAccount(account.id);
        deps.out(`ended ${String(ended)} session(s) for ${account.username}`);
        return 0;
      }
      case 'list': {
        const accounts = store.accounts.list();
        if (accounts.length === 0) {
          deps.out('no accounts yet');
          return 0;
        }
        for (const account of accounts) {
          deps.out(describe(account));
        }
        return 0;
      }
      default:
        throw new AuthCliError('AUTH_CLI_USAGE', `unknown command ${options.command}`);
    }
  } finally {
    if (opened) {
      store.close();
    }
  }
}

/**
 * The command line around the commands: parse, run, and turn anything thrown
 * into a message and a usage note rather than a stack trace.
 */
export async function main(argv: readonly string[], deps: AuthCliDeps): Promise<number> {
  try {
    return await runAuthCli(parseAuthCli(argv), deps);
  } catch (error) {
    deps.out(describeError(error).message);
    deps.out(USAGE);
    return 2;
  }
}

export { ROLES };
