import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createHarness, type TestHarness } from '../../test/helpers/tool-context.js';
import { CacheMissError } from '../cache/index.js';
import { NO_SPEND_POLICY } from './policy.js';
import { isCacheMiss, withSpend } from './spend.js';
import type { ToolContext } from './types.js';

let harness: TestHarness;
let context: ToolContext;

beforeEach(async () => {
  harness = await createHarness();
  context = harness.context;
});

afterEach(async () => {
  await harness.close();
});

describe('withSpend', () => {
  it('runs against the cache alone until the caller confirms', async () => {
    const modes: boolean[] = [];
    const run = (options: { cacheOnly: boolean }): Promise<string> => {
      modes.push(options.cacheOnly);
      return Promise.resolve('answered');
    };

    expect(await withSpend('a_tool', context, undefined, run)).toEqual({
      ok: true,
      value: 'answered',
    });
    expect(await withSpend('a_tool', context, true, run)).toEqual({ ok: true, value: 'answered' });
    expect(modes).toEqual([true, false]);
  });

  it('asks for confirmation when the cache cannot answer', async () => {
    const outcome = await withSpend('a_tool', context, undefined, () =>
      Promise.reject(new CacheMissError('CACHE_MISS', 'nothing stored')),
    );

    expect(outcome).toEqual({
      ok: false,
      result: {
        status: 'needs_confirmation',
        tool: 'a_tool',
        reason: 'the answer is not cached, so this call would spend distributor quota',
        retryWith: { confirmSpend: true },
      },
    });
  });

  it('lets any other failure through: it is not a question about spending', async () => {
    await expect(
      withSpend('a_tool', context, undefined, () => Promise.reject(new Error('the API is down'))),
    ).rejects.toThrow('the API is down');
  });

  it('refuses outright under a policy that may not spend', async () => {
    const denied = await createHarness({ policy: NO_SPEND_POLICY });
    try {
      const outcome = await withSpend('a_tool', denied.context, true, () =>
        Promise.resolve('never reached'),
      );
      expect(outcome).toEqual({
        ok: false,
        result: {
          status: 'denied',
          tool: 'a_tool',
          reason: 'this run is not allowed to spend quota, confirmed or not',
        },
      });
    } finally {
      await denied.close();
    }
  });
});

describe('isCacheMiss', () => {
  it('is true only for a cache-only call that found nothing', () => {
    expect(isCacheMiss(new CacheMissError('CACHE_MISS', 'nothing stored'))).toBe(true);
    expect(isCacheMiss(new CacheMissError('CACHE_OPTIONS_CONFLICT', 'both set'))).toBe(false);
    expect(isCacheMiss(new Error('CACHE_MISS'))).toBe(false);
  });
});
