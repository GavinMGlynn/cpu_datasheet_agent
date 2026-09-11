import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  AGENT_EFFORTS,
  ConfigError,
  ENV_VARIABLE_NAMES,
  LOG_LEVELS,
  loadConfig,
  loadEnvFileIfPresent,
  type EnvSource,
} from './config.js';
import { isChipAgentError } from './errors.js';

const CWD = '/work';

function load(env: EnvSource = {}) {
  return loadConfig(env, { cwd: CWD });
}

function issuesOf(env: EnvSource) {
  try {
    load(env);
  } catch (error) {
    if (error instanceof ConfigError) {
      return error.issues;
    }
    throw error;
  }
  throw new Error('expected loadConfig to throw');
}

function expectIssue(env: EnvSource, variable: string, messagePart: string) {
  const issues = issuesOf(env);
  expect(issues).toHaveLength(1);
  expect(issues[0]?.variable).toBe(variable);
  expect(issues[0]?.message).toContain(messagePart);
}

describe('loadConfig defaults', () => {
  it('produces the documented defaults from an empty environment', () => {
    expect(load({})).toEqual({
      digikey: {
        clientId: undefined,
        clientSecret: undefined,
        sandbox: false,
        production: { clientId: undefined, clientSecret: undefined },
        sandboxApp: { clientId: undefined, clientSecret: undefined },
        locale: { site: 'AU', language: 'en', currency: 'AUD' },
      },
      mouser: { apiKey: undefined },
      farnell: { apiKey: undefined, store: 'uk.farnell.com' },
      nexar: { clientId: undefined, clientSecret: undefined, enabled: false, budgetLimit: 90 },
      anthropic: { apiKey: undefined },
      agent: { model: 'claude-opus-5', effort: 'high' },
      dataDir: path.resolve(CWD, 'data'),
      logLevel: 'info',
      liveTests: false,
    });
  });

  it('treats blank and whitespace-only values as unset', () => {
    const config = load({
      DIGIKEY_CLIENT_ID: '',
      MOUSER_API_KEY: '   ',
      NEXAR_BUDGET_LIMIT: '',
      LOG_LEVEL: '  ',
      DATA_DIR: '\t',
    });

    expect(config.digikey.clientId).toBeUndefined();
    expect(config.mouser.apiKey).toBeUndefined();
    expect(config.nexar.budgetLimit).toBe(90);
    expect(config.logLevel).toBe('info');
    expect(config.dataDir).toBe(path.resolve(CWD, 'data'));
  });

  it('trims surrounding whitespace from values', () => {
    const config = load({ DIGIKEY_CLIENT_ID: '  abc  ', AGENT_MODEL: ' claude-sonnet-5 ' });

    expect(config.digikey.clientId).toBe('abc');
    expect(config.agent.model).toBe('claude-sonnet-5');
  });

  it('ignores unrelated variables', () => {
    expect(() => load({ PATH: '/usr/bin', HOME: '/home/x' })).not.toThrow();
  });

  it('reads process.env when no source is given', () => {
    for (const name of ENV_VARIABLE_NAMES) {
      vi.stubEnv(name, '');
    }
    try {
      const config = loadConfig();
      expect(config.agent.model).toBe('claude-opus-5');
      expect(config.dataDir).toBe(path.resolve(process.cwd(), 'data'));
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('loadConfig Digi-Key credential selection', () => {
  const both = {
    DIGIKEY_CLIENT_ID: 'prod-id',
    DIGIKEY_CLIENT_SECRET: 'prod-secret',
    DIGIKEY_SANDBOX_CLIENT_ID: 'sand-id',
    DIGIKEY_SANDBOX_CLIENT_SECRET: 'sand-secret',
  };

  it('selects the production pair by default', () => {
    const config = load(both);

    expect(config.digikey.sandbox).toBe(false);
    expect(config.digikey.clientId).toBe('prod-id');
    expect(config.digikey.clientSecret).toBe('prod-secret');
  });

  it('selects the sandbox pair when the sandbox is enabled', () => {
    const config = load({ ...both, DIGIKEY_SANDBOX: '1' });

    expect(config.digikey.sandbox).toBe(true);
    expect(config.digikey.clientId).toBe('sand-id');
    expect(config.digikey.clientSecret).toBe('sand-secret');
  });

  it('keeps both pairs available whichever is selected', () => {
    const config = load({ ...both, DIGIKEY_SANDBOX: '1' });

    expect(config.digikey.production).toEqual({ clientId: 'prod-id', clientSecret: 'prod-secret' });
    expect(config.digikey.sandboxApp).toEqual({ clientId: 'sand-id', clientSecret: 'sand-secret' });
  });

  it('leaves the selected pair undefined when only the other is configured', () => {
    const production = load({ DIGIKEY_CLIENT_ID: 'prod-id', DIGIKEY_SANDBOX: '1' });

    expect(production.digikey.clientId).toBeUndefined();
    expect(production.digikey.production.clientId).toBe('prod-id');
  });
});

describe('loadConfig booleans', () => {
  const trueWords = ['1', 'true', 'yes', 'on', 'TRUE', 'Yes', 'ON'];
  const falseWords = ['0', 'false', 'no', 'off', 'FALSE', 'No', 'OFF'];

  it.each(trueWords)('accepts "%s" as true', (word) => {
    const config = load({ DIGIKEY_SANDBOX: word, NEXAR_ENABLED: word, LIVE_TESTS: word });
    expect(config.digikey.sandbox).toBe(true);
    expect(config.nexar.enabled).toBe(true);
    expect(config.liveTests).toBe(true);
  });

  it.each(falseWords)('accepts "%s" as false', (word) => {
    const config = load({ DIGIKEY_SANDBOX: word, NEXAR_ENABLED: word, LIVE_TESTS: word });
    expect(config.digikey.sandbox).toBe(false);
    expect(config.nexar.enabled).toBe(false);
    expect(config.liveTests).toBe(false);
  });

  it.each(['2', 'maybe', 'y', 'n', 't'])('rejects "%s"', (word) => {
    expectIssue({ DIGIKEY_SANDBOX: word }, 'DIGIKEY_SANDBOX', 'expected a boolean');
  });
});

describe('loadConfig NEXAR_BUDGET_LIMIT', () => {
  it.each([
    ['0', 0],
    ['1', 1],
    ['50', 50],
    ['100', 100],
  ])('accepts "%s"', (text, expected) => {
    expect(load({ NEXAR_BUDGET_LIMIT: text }).nexar.budgetLimit).toBe(expected);
  });

  it.each(['-1', '101', '1000'])('rejects out-of-range "%s"', (text) => {
    expectIssue({ NEXAR_BUDGET_LIMIT: text }, 'NEXAR_BUDGET_LIMIT', 'between 0 and 100');
  });

  it.each(['1.5', 'abc', '10a', '0x10', '+5'])('rejects non-integer "%s"', (text) => {
    expectIssue({ NEXAR_BUDGET_LIMIT: text }, 'NEXAR_BUDGET_LIMIT', 'expected an integer');
  });
});

describe('loadConfig enums', () => {
  it.each(AGENT_EFFORTS)('accepts effort "%s"', (effort) => {
    expect(load({ AGENT_EFFORT: effort }).agent.effort).toBe(effort);
  });

  it.each(LOG_LEVELS)('accepts log level "%s"', (level) => {
    expect(load({ LOG_LEVEL: level }).logLevel).toBe(level);
  });

  it('rejects unknown effort and log level values, including wrong case', () => {
    expectIssue(
      { AGENT_EFFORT: 'High' },
      'AGENT_EFFORT',
      'expected one of low, medium, high, xhigh, max',
    );
    expectIssue({ AGENT_EFFORT: 'extreme' }, 'AGENT_EFFORT', 'received "extreme"');
    expectIssue({ LOG_LEVEL: 'verbose' }, 'LOG_LEVEL', 'expected one of debug, info, warn, error');
  });
});

describe('loadConfig Farnell store', () => {
  it.each(['au.element14.com', 'uk.farnell.com', 'www.newark.com', 'sg.element14.com'])(
    'accepts %s',
    (store) => {
      expect(load({ FARNELL_STORE: store }).farnell.store).toBe(store);
    },
  );

  it.each(['element14.com', 'au.element14.co.uk', 'example.com', 'AU.ELEMENT14.COM'])(
    'rejects %j',
    (store) => {
      expectIssue({ FARNELL_STORE: store }, 'FARNELL_STORE', 'element14 store');
    },
  );

  it('keeps the key alongside the store', () => {
    const config = load({ FARNELL_API_KEY: 'abc', FARNELL_STORE: 'au.element14.com' });

    expect(config.farnell).toEqual({ apiKey: 'abc', store: 'au.element14.com' });
  });
});

describe('loadConfig patterns', () => {
  it('accepts well-formed locale values', () => {
    const config = load({
      DIGIKEY_LOCALE_SITE: 'US',
      DIGIKEY_LOCALE_LANGUAGE: 'de',
      DIGIKEY_LOCALE_CURRENCY: 'EUR',
    });
    expect(config.digikey.locale).toEqual({ site: 'US', language: 'de', currency: 'EUR' });
  });

  it.each(['us', 'USA', 'A', 'A1'])('rejects site "%s"', (site) => {
    expectIssue(
      { DIGIKEY_LOCALE_SITE: site },
      'DIGIKEY_LOCALE_SITE',
      'two-letter uppercase country code',
    );
  });

  it.each(['EN', 'eng', 'e'])('rejects language "%s"', (language) => {
    expectIssue(
      { DIGIKEY_LOCALE_LANGUAGE: language },
      'DIGIKEY_LOCALE_LANGUAGE',
      'two-letter lowercase language code',
    );
  });

  it.each(['aud', 'AUDX', 'AU'])('rejects currency "%s"', (currency) => {
    expectIssue(
      { DIGIKEY_LOCALE_CURRENCY: currency },
      'DIGIKEY_LOCALE_CURRENCY',
      'three-letter uppercase currency code',
    );
  });

  it.each(['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001', 'm1.2'])(
    'accepts model ID "%s"',
    (model) => {
      expect(load({ AGENT_MODEL: model }).agent.model).toBe(model);
    },
  );

  it.each(['Claude-Opus-5', '-leading', 'has space', 'under_score'])(
    'rejects model ID "%s"',
    (model) => {
      expectIssue({ AGENT_MODEL: model }, 'AGENT_MODEL', 'expected a model ID');
    },
  );
});

describe('loadConfig DATA_DIR', () => {
  it('resolves a relative path against the given cwd', () => {
    expect(load({ DATA_DIR: 'store/here' }).dataDir).toBe(path.resolve(CWD, 'store/here'));
    expect(load({ DATA_DIR: '../up' }).dataDir).toBe(path.resolve(CWD, '../up'));
  });

  it('keeps an absolute path unchanged', () => {
    expect(load({ DATA_DIR: '/var/lib/chip' }).dataDir).toBe('/var/lib/chip');
  });

  it('resolves against the process working directory when no cwd is given', () => {
    expect(loadConfig({ DATA_DIR: 'rel' }).dataDir).toBe(path.resolve(process.cwd(), 'rel'));
  });
});

describe('loadConfig error reporting', () => {
  it('reports every invalid variable in one error', () => {
    const issues = issuesOf({
      DIGIKEY_SANDBOX: 'perhaps',
      NEXAR_BUDGET_LIMIT: '500',
      LOG_LEVEL: 'loud',
    });

    expect(issues.map((issue) => issue.variable)).toEqual([
      'DIGIKEY_SANDBOX',
      'NEXAR_BUDGET_LIMIT',
      'LOG_LEVEL',
    ]);
  });

  it('throws a ConfigError that is a ChipAgentError with code CONFIG_INVALID and the issues in details', () => {
    let caught: unknown;
    try {
      load({ LIVE_TESTS: 'sometimes' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConfigError);
    expect(isChipAgentError(caught)).toBe(true);
    const error = caught as ConfigError;
    expect(error.code).toBe('CONFIG_INVALID');
    expect(error.name).toBe('ConfigError');
    expect(error.message).toBe(
      'Invalid configuration:\n  LIVE_TESTS: expected a boolean (1/0/true/false/yes/no/on/off), received "sometimes"',
    );
    expect(error.details).toEqual({ issues: error.issues });
  });
});

describe('loadConfig result', () => {
  it('is deeply frozen', () => {
    const config = load({});

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.digikey)).toBe(true);
    expect(Object.isFrozen(config.digikey.production)).toBe(true);
    expect(Object.isFrozen(config.digikey.sandboxApp)).toBe(true);
    expect(Object.isFrozen(config.digikey.locale)).toBe(true);
    expect(Object.isFrozen(config.nexar)).toBe(true);
    expect(Object.isFrozen(config.agent)).toBe(true);
  });
});

describe('.env.example', () => {
  it('lists exactly the variables the config reads, in the same order', async () => {
    const text = await readFile(path.resolve(import.meta.dirname, '..', '.env.example'), 'utf8');
    const listed = text
      .split('\n')
      .map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1])
      .filter((name): name is string => name !== undefined);

    expect(listed).toEqual([...ENV_VARIABLE_NAMES]);
  });
});

describe('loadEnvFileIfPresent', () => {
  it('loads a file when there is one and says so', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'env-'));
    const file = path.join(dir, '.env');
    await writeFile(file, 'CHIP_TEST_VARIABLE=from-the-file\n');
    try {
      expect(loadEnvFileIfPresent(file)).toBe(true);
      expect(process.env.CHIP_TEST_VARIABLE).toBe('from-the-file');
    } finally {
      delete process.env.CHIP_TEST_VARIABLE;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('says so when there is none, which is normal in CI', () => {
    expect(loadEnvFileIfPresent('/nowhere/.env')).toBe(false);
  });
});
