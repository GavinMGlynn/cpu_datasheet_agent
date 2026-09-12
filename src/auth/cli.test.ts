import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { USAGE, main, parseAuthCli, runAuthCli, type AuthCliDeps } from './cli.js';
import { verifyPassword } from './password.js';
import { createAuthStore, type AuthStore } from './store.js';

/**
 * The account commands.
 *
 * The store is opened once and handed to every command, so a test can look
 * at what a command did rather than at what it printed. What it printed is
 * checked too: this is the only interface to accounts, and a command that
 * succeeds silently is a command nobody trusts.
 */

const PASSWORD = 'correct horse battery staple';

let store: AuthStore;
let lines: string[];
let asked: string[];
let deps: AuthCliDeps;

beforeEach(() => {
  store = createAuthStore(':memory:');
  lines = [];
  asked = [];
  deps = {
    env: { DATA_DIR: '/nowhere' },
    out: (line) => lines.push(line),
    askPassword: (prompt) => {
      asked.push(prompt);
      return Promise.resolve(PASSWORD);
    },
    readStdin: () => Promise.resolve(`${PASSWORD}\n`),
    clock: () => new Date('2026-09-12T09:00:00.000Z'),
    openStore: () => store,
  };
});

afterEach(() => {
  store.close();
});

async function run(argv: readonly string[]): Promise<number> {
  return runAuthCli(parseAuthCli(argv), deps);
}

describe('parseAuthCli', () => {
  it('reads every flag and the positional arguments', () => {
    expect(
      parseAuthCli([
        'add',
        'gavin',
        '--role',
        'admin',
        '--name',
        'Gavin',
        '--data',
        '/tmp/data',
        '--auth',
        '/tmp/auth.sqlite',
        '--issuer',
        'https://issuer.invalid',
        '--subject',
        'subject-1',
        '--password-stdin',
      ]),
    ).toStrictEqual({
      command: 'add',
      args: ['gavin'],
      role: 'admin',
      name: 'Gavin',
      dataDir: '/tmp/data',
      authFile: '/tmp/auth.sqlite',
      issuer: 'https://issuer.invalid',
      subject: 'subject-1',
      passwordStdin: true,
      help: false,
    });
  });

  it('takes help either way round, and refuses what it does not know', () => {
    expect(parseAuthCli(['--help']).help).toBe(true);
    expect(parseAuthCli(['-h']).help).toBe(true);
    expect(() => parseAuthCli(['--nonsense'])).toThrow(
      expect.objectContaining({ code: 'AUTH_CLI_USAGE' }),
    );
    expect(() => parseAuthCli(['--role'])).toThrow(/needs a value/u);
  });
});

describe('add', () => {
  it('creates an account with a hashed password', async () => {
    expect(await run(['add', 'gavin', '--role', 'admin', '--name', 'Gavin'])).toBe(0);
    const account = store.accounts.byUsername('gavin');
    expect(account).toMatchObject({ role: 'admin', displayName: 'Gavin', hasPassword: true });
    const stored = store.accounts.passwordHash(account?.id ?? '');
    expect(stored).not.toContain(PASSWORD);
    await expect(verifyPassword(PASSWORD, stored ?? '')).resolves.toBe(true);
    expect(lines[0]).toBe('added gavin as admin');
  });

  it('asks for the password twice, and never takes it from the command line', async () => {
    await run(['add', 'gavin', '--role', 'viewer']);
    expect(asked).toHaveLength(2);
    expect(asked[0]).toContain('at least 12 characters');
  });

  it('refuses when the two do not match', async () => {
    let count = 0;
    deps = {
      ...deps,
      askPassword: () => Promise.resolve(count++ === 0 ? PASSWORD : 'something else entirely'),
    };
    await expect(run(['add', 'gavin', '--role', 'admin'])).rejects.toThrow(
      expect.objectContaining({ code: 'AUTH_CLI_MISMATCH' }),
    );
    expect(store.accounts.count()).toBe(0);
  });

  it('takes one from standard input, for a script', async () => {
    deps = { ...deps, askPassword: vi.fn() };
    expect(await run(['add', 'gavin', '--role', 'admin', '--password-stdin'])).toBe(0);
    expect(deps.askPassword).not.toHaveBeenCalled();
    expect(store.accounts.byUsername('gavin')?.hasPassword).toBe(true);
  });

  it('refuses a password the policy would not store, from either source', async () => {
    deps = {
      ...deps,
      askPassword: () => Promise.resolve('short'),
      readStdin: () => Promise.resolve('short\n'),
    };
    await expect(run(['add', 'gavin', '--role', 'admin'])).rejects.toThrow(
      expect.objectContaining({ code: 'AUTH_PASSWORD_TOO_SHORT' }),
    );
    await expect(run(['add', 'gavin', '--role', 'admin', '--password-stdin'])).rejects.toThrow(
      expect.objectContaining({ code: 'AUTH_PASSWORD_TOO_SHORT' }),
    );
  });

  it('defaults to the role that can do the least', async () => {
    await run(['add', 'onlooker']);
    expect(store.accounts.byUsername('onlooker')?.role).toBe('viewer');
  });

  it('refuses a username that is not one, and one already taken', async () => {
    await expect(run(['add', 'a b'])).rejects.toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
    await run(['add', 'gavin']);
    await expect(run(['add', 'gavin'])).rejects.toThrow(
      expect.objectContaining({ code: 'AUTH_ACCOUNT_EXISTS' }),
    );
  });
});

describe('the commands on an existing account', () => {
  beforeEach(async () => {
    await run(['add', 'gavin', '--role', 'admin']);
    lines = [];
  });

  it('changes the password and ends every session', async () => {
    const account = store.accounts.byUsername('gavin');
    store.sessions.create({
      id: 'a-session',
      accountId: account?.id ?? '',
      csrf: 'csrf',
      createdAt: '2026-09-12T09:00:00.000Z',
      lastSeenAt: '2026-09-12T09:00:00.000Z',
      expiresAt: '2026-09-13T09:00:00.000Z',
    });
    expect(await run(['passwd', 'gavin'])).toBe(0);
    expect(lines[0]).toContain('1 session(s) ended');
    expect(store.sessions.byId('a-session')).toBeUndefined();
  });

  it('changes the role', async () => {
    expect(await run(['role', 'gavin', 'viewer'])).toBe(0);
    expect(store.accounts.byUsername('gavin')?.role).toBe('viewer');
    await expect(run(['role', 'gavin', 'root'])).rejects.toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
  });

  it('disables an account and ends its sessions, and enables it again', async () => {
    const account = store.accounts.byUsername('gavin');
    store.sessions.create({
      id: 'a-session',
      accountId: account?.id ?? '',
      csrf: 'csrf',
      createdAt: '2026-09-12T09:00:00.000Z',
      lastSeenAt: '2026-09-12T09:00:00.000Z',
      expiresAt: '2026-09-13T09:00:00.000Z',
    });
    expect(await run(['disable', 'gavin'])).toBe(0);
    expect(store.accounts.byUsername('gavin')?.disabledAt).toBeDefined();
    expect(store.sessions.byId('a-session')).toBeUndefined();
    expect(await run(['enable', 'gavin'])).toBe(0);
    expect(store.accounts.byUsername('gavin')?.disabledAt).toBeUndefined();
  });

  it('binds an identity provider to the account', async () => {
    expect(
      await run(['bind', 'gavin', '--issuer', 'https://issuer.invalid', '--subject', 'sub-1']),
    ).toBe(0);
    expect(store.accounts.byUsername('gavin')).toMatchObject({
      issuer: 'https://issuer.invalid',
      subject: 'sub-1',
    });
    await expect(run(['bind', 'gavin', '--subject', 'sub-1'])).rejects.toThrow(/needs a value/u);
    await expect(run(['bind', 'gavin', '--issuer', 'https://issuer.invalid'])).rejects.toThrow(
      /needs a value/u,
    );
  });

  it('lists the sessions, and says when there are none', async () => {
    expect(await run(['sessions', 'gavin'])).toBe(0);
    expect(lines[0]).toBe('gavin has no sessions');
    const account = store.accounts.byUsername('gavin');
    store.sessions.create({
      id: 'a-session',
      accountId: account?.id ?? '',
      csrf: 'csrf',
      createdAt: '2026-09-12T09:00:00.000Z',
      lastSeenAt: '2026-09-12T10:00:00.000Z',
      expiresAt: '2026-09-13T09:00:00.000Z',
      userAgent: 'a browser',
      address: '127.0.0.1',
    });
    lines = [];
    await run(['sessions', 'gavin']);
    expect(lines[0]).toContain('a browser');
    expect(lines[0]).toContain('127.0.0.1');
    store.sessions.create({
      id: 'another',
      accountId: account?.id ?? '',
      csrf: 'csrf',
      createdAt: '2026-09-12T08:00:00.000Z',
      lastSeenAt: '2026-09-12T08:00:00.000Z',
      expiresAt: '2026-09-13T08:00:00.000Z',
    });
    lines = [];
    await run(['sessions', 'gavin']);
    expect(lines[1]).toContain('no user agent');
  });

  it('revokes every session', async () => {
    const account = store.accounts.byUsername('gavin');
    store.sessions.create({
      id: 'a-session',
      accountId: account?.id ?? '',
      csrf: 'csrf',
      createdAt: '2026-09-12T09:00:00.000Z',
      lastSeenAt: '2026-09-12T09:00:00.000Z',
      expiresAt: '2026-09-13T09:00:00.000Z',
    });
    expect(await run(['revoke', 'gavin'])).toBe(0);
    expect(lines[0]).toBe('ended 1 session(s) for gavin');
  });

  it('lists the accounts', async () => {
    await run(['add', 'sso', '--role', 'viewer', '--password-stdin']);
    store.accounts.setPassword(store.accounts.byUsername('sso')?.id ?? '', null);
    store.accounts.setDisabled(store.accounts.byUsername('sso')?.id ?? '', true);
    store.accounts.bindIdentity(
      store.accounts.byUsername('sso')?.id ?? '',
      'https://issuer.invalid',
      'sub-1',
    );
    lines = [];
    expect(await run(['list'])).toBe(0);
    expect(lines[0]).toContain('gavin');
    expect(lines[0]).toContain('password');
    expect(lines[1]).toContain('no password');
    expect(lines[1]).toContain('disabled');
    expect(lines[1]).toContain('https://issuer.invalid');
  });

  it('says when the account is not there', async () => {
    for (const command of [
      ['passwd', 'nobody'],
      ['role', 'nobody', 'admin'],
      ['disable', 'nobody'],
      ['bind', 'nobody', '--issuer', 'x', '--subject', 'y'],
      ['sessions', 'nobody'],
      ['revoke', 'nobody'],
    ]) {
      await expect(run(command)).rejects.toThrow(
        expect.objectContaining({ code: 'AUTH_CLI_NO_ACCOUNT' }),
      );
    }
  });
});

describe('list with nothing in it', () => {
  it('says so rather than printing a blank line', async () => {
    expect(await run(['list'])).toBe(0);
    expect(lines[0]).toBe('no accounts yet');
  });
});

describe('the database it opens', () => {
  it('opens the one under the data directory, and closes it again', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'chip-auth-cli-'));
    try {
      const { openStore: _injected, ...real } = deps;
      expect(
        await runAuthCli(parseAuthCli(['add', 'gavin', '--data', root, '--password-stdin']), real),
      ).toBe(0);
      // Opened again from scratch: the first command closed what it opened.
      const check = createAuthStore(path.join(root, 'auth.sqlite'));
      expect(check.accounts.byUsername('gavin')).toBeDefined();
      check.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reads the clock when nobody fixes it', async () => {
    const { clock: _fixed, ...running } = deps;
    await runAuthCli(parseAuthCli(['add', 'gavin', '--password-stdin']), running);
    const created = store.accounts.byUsername('gavin');
    expect(Date.parse(created?.createdAt ?? '')).toBeGreaterThan(Date.now() - 60_000);
  });

  it('takes the file it is pointed at directly', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'chip-auth-cli-'));
    try {
      const { openStore: _injected, ...real } = deps;
      const file = path.join(root, 'nested', 'accounts.sqlite');
      await runAuthCli(parseAuthCli(['add', 'gavin', '--auth', file, '--password-stdin']), real);
      const check = createAuthStore(file);
      expect(check.accounts.count()).toBe(1);
      check.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('main', () => {
  it('turns a refusal into a message and a usage note', async () => {
    expect(await main(['--nonsense'], deps)).toBe(2);
    expect(lines[0]).toContain('unknown option');
    expect(lines[1]).toBe(USAGE);
  });

  it('turns a failed command into the same', async () => {
    expect(await main(['passwd', 'nobody'], deps)).toBe(2);
    expect(lines[0]).toContain('there is no account called nobody');
  });

  it('returns what the command returned when it worked', async () => {
    expect(await main(['add', 'gavin', '--password-stdin'], deps)).toBe(0);
    expect(lines[0]).toBe('added gavin as admin'.replace('admin', 'viewer'));
  });
});

describe('usage', () => {
  it('prints it for --help, and for no command at all', async () => {
    expect(await run(['--help'])).toBe(0);
    expect(lines[0]).toBe(USAGE);
    lines = [];
    expect(await run([])).toBe(2);
    expect(lines[0]).toBe(USAGE);
  });

  it('refuses a command it does not have', async () => {
    await expect(run(['frobnicate'])).rejects.toThrow(
      expect.objectContaining({ code: 'AUTH_CLI_USAGE' }),
    );
  });
});
