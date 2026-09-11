import { describe, expect, it } from 'vitest';

import { loadConfig } from '../config.js';
import { DEFAULT_QUOTA_POLICY, NO_SPEND_POLICY } from '../tools/index.js';
import {
  DEFAULT_MAX_COST_USD,
  DEFAULT_MAX_TURNS,
  DEFAULT_EXTRACT_PROMPT_VERSION,
  RunConfig,
  defaultRunConfig,
  policyFor,
} from './config.js';

const config = loadConfig({ DATA_DIR: '/tmp/chip-data', AGENT_MODEL: 'claude-opus-5' });

function runConfig(overrides: Record<string, unknown> = {}): unknown {
  return { ...defaultRunConfig(config), ...overrides };
}

describe('defaultRunConfig', () => {
  it('takes the model and data directory from the environment and spends nothing', () => {
    const built = defaultRunConfig(config);

    expect(built).toEqual({
      model: 'claude-opus-5',
      effort: 'high',
      maxTurns: DEFAULT_MAX_TURNS,
      maxCostUsd: DEFAULT_MAX_COST_USD,
      promptVersion: DEFAULT_EXTRACT_PROMPT_VERSION,
      allowSpend: false,
      dataDir: '/tmp/chip-data',
    });
  });
});

describe('RunConfig', () => {
  it('accepts a configuration a command line produced', () => {
    expect(
      RunConfig.parse(runConfig({ effort: 'max', maxTurns: 10, allowSpend: true })),
    ).toMatchObject({ effort: 'max', maxTurns: 10, allowSpend: true });
  });

  it.each([
    ['no turns', { maxTurns: 0 }],
    ['a fractional turn limit', { maxTurns: 1.5 }],
    ['a cost ceiling of nothing', { maxCostUsd: 0 }],
    ['an effort it does not have', { effort: 'enormous' }],
    ['an unversioned prompt', { promptVersion: 'extract' }],
    ['an empty data directory', { dataDir: '' }],
    ['an extra key', { verbose: true }],
  ])('refuses %s', (_label, overrides) => {
    expect(RunConfig.safeParse(runConfig(overrides)).success).toBe(false);
  });
});

describe('policyFor', () => {
  it('refuses every spend unless the run allows one', () => {
    expect(policyFor(RunConfig.parse(runConfig()))).toBe(NO_SPEND_POLICY);
    expect(policyFor(RunConfig.parse(runConfig({ allowSpend: true })))).toBe(DEFAULT_QUOTA_POLICY);
  });
});
