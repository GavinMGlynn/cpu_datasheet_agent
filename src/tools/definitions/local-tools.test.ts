import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buckParameters,
  distributorProvenance,
  param,
  part,
  q,
  verification,
  verificationClaim,
} from '../../../test/helpers/core-fixtures.js';
import { createHarness, TEST_NOW, type TestHarness } from '../../../test/helpers/tool-context.js';
import { ValidationError } from '../../core/index.js';
import { NO_SPEND_POLICY } from '../policy.js';
import type { ToolRegistry } from '../registry.js';
import { buildRegistry } from './index.js';

let harness: TestHarness;
let registry: ToolRegistry;

async function call(name: string, input: unknown): Promise<Record<string, unknown>> {
  return (await registry.call(name, input, harness.context)) as Record<string, unknown>;
}

beforeEach(async () => {
  harness = await createHarness();
  registry = buildRegistry();
});

afterEach(async () => {
  await harness.close();
});

describe('nexar_budget_status and cache_stats', () => {
  it('reports the budget as seeded', async () => {
    expect(await call('nexar_budget_status', {})).toEqual({ used: 0, limit: 90, remaining: 90 });
  });

  it('reports the cache counters of this process', async () => {
    expect(await call('cache_stats', {})).toEqual({
      hits: 0,
      misses: 0,
      expired: 0,
      forced: 0,
      joined: 0,
    });
  });

  it('rejects an argument neither of them takes', async () => {
    await expect(call('cache_stats', { verbose: true })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('upsert_part and get_part', () => {
  it('stores a part and reads it back unchanged', async () => {
    const stored = await call('upsert_part', { part: part() });
    expect(stored.part).toEqual(part());
    expect((await call('get_part', { mpn: 'TPS54331DR' })).part).toEqual(part());
  });

  it('returns null for a part nobody has stored', async () => {
    expect(await call('get_part', { mpn: 'LM2596S' })).toEqual({ part: null });
  });

  it('rejects the CLAUDE.md case rather than coercing it', async () => {
    // A string where a min/max pair belongs must fail loudly.
    const broken = part({ parameters: buckParameters({ vinMax: param('3 V to 32 V') }) });
    await expect(call('upsert_part', { part: broken })).rejects.toBeInstanceOf(ValidationError);
    expect((await call('get_part', { mpn: 'TPS54331DR' })).part).toBeNull();
  });

  it('rejects a datasheet-cited parameter with no datasheet attached', async () => {
    const { datasheet: _datasheet, ...withoutDatasheet } = part();
    await expect(call('upsert_part', { part: withoutDatasheet })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe('search_parts', () => {
  beforeEach(async () => {
    await call('upsert_part', { part: part() });
  });

  it('finds a part by classification axis and value', async () => {
    const found = await call('search_parts', {
      classifications: [{ axis: 'vinClass', value: 'le_42v' }],
    });
    expect((found.parts as unknown[]).length).toBe(1);
    expect(
      await call('search_parts', { classifications: [{ axis: 'vinClass', value: 'le_5v5' }] }),
    ).toEqual({ parts: [] });
  });

  it('finds a part by a numeric parameter bound', async () => {
    expect(
      (
        (await call('search_parts', { parameters: [{ key: 'vinMax', min: 20 }] }))
          .parts as unknown[]
      ).length,
    ).toBe(1);
    expect(
      (
        (await call('search_parts', { parameters: [{ key: 'vinMax', min: 40 }] }))
          .parts as unknown[]
      ).length,
    ).toBe(0);
  });

  it('filters by status and category', async () => {
    expect(
      (
        (await call('search_parts', { status: 'extracted', category: 'buck_regulator' }))
          .parts as unknown[]
      ).length,
    ).toBe(1);
    expect(((await call('search_parts', { status: 'verified' })).parts as unknown[]).length).toBe(
      0,
    );
  });
});

describe('record_verification', () => {
  /** The run stamps itself on the record; the reader states only what it read. */
  async function inRun(input: unknown): Promise<Record<string, unknown>> {
    const running = await createHarness({
      run: { promptVersion: 'verify.v1', model: 'test-model' },
    });
    try {
      await registry.call('upsert_part', { part: part() }, running.context);
      return (await registry.call('record_verification', input, running.context)) as Record<
        string,
        unknown
      >;
    } finally {
      await running.close();
    }
  }

  it('records a verdict against a stored part, stamped with the run', async () => {
    const recorded = await inRun({ mpn: 'TPS54331DR', verification: verificationClaim() });

    expect(recorded.verification).toEqual({
      ...verification(),
      checkedAt: TEST_NOW,
      promptVersion: 'verify.v1',
      model: 'test-model',
    });
  });

  it('refuses to record against a part nobody has stored', async () => {
    await expect(
      call('record_verification', { mpn: 'TPS54331DR', verification: verificationClaim() }),
    ).rejects.toMatchObject({ code: 'TOOL_NOT_FOUND' });
  });

  it('refuses to record outside a run, which would leave nobody named as the reader', async () => {
    await call('upsert_part', { part: part() });

    await expect(
      call('record_verification', { mpn: 'TPS54331DR', verification: verificationClaim() }),
    ).rejects.toMatchObject({ code: 'TOOL_UNAVAILABLE' });
  });

  it('rejects a confirmed verdict with no quote', async () => {
    const { quote: _quote, ...noQuote } = verificationClaim();
    await expect(inRun({ mpn: 'TPS54331DR', verification: noQuote })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe('ask_human and list_escalations', () => {
  const question = {
    mpn: 'TPS54331DR',
    kind: 'conflict',
    question: 'Datasheet says 28 V, Digi-Key says 36 V. Which is right?',
    context: [
      { key: 'datasheet', value: '28 V on page 5' },
      { key: 'distributor', value: '36 V from Digi-Key' },
    ],
    options: ['datasheet: 28 V', 'digikey: 36 V'],
  };

  it('records the question and returns without waiting', async () => {
    const asked = await call('ask_human', question);

    expect(asked).toEqual({
      id: harness.ids[0],
      createdAt: TEST_NOW,
      markedNeedsHuman: false,
    });
    const listed = (await call('list_escalations', {})).escalations as { id: string }[];
    expect(listed.map((escalation) => escalation.id)).toEqual([harness.ids[0]]);
  });

  it('stores the labelled facts as the escalation keeps them', async () => {
    await call('ask_human', question);

    const listed = (await call('list_escalations', {})).escalations as {
      context: Record<string, unknown>;
    }[];
    expect(listed[0]?.context).toEqual({
      datasheet: '28 V on page 5',
      distributor: '36 V from Digi-Key',
    });
  });

  it('refuses the same fact twice under one key', async () => {
    await expect(
      call('ask_human', {
        ...question,
        context: [
          { key: 'datasheet', value: '28 V' },
          { key: 'datasheet', value: '30 V' },
        ],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('records a question with no options and no context to go with it', async () => {
    const { options: _options, context: _context, ...open } = question;

    const asked = await call('ask_human', open);

    const listed = (await call('list_escalations', {})).escalations as { options?: string[] }[];
    expect(asked.id).toBe(harness.ids[0]);
    expect(listed[0]).not.toHaveProperty('options');
  });

  it('marks a stored part as needing a person, headless', async () => {
    await call('upsert_part', { part: part() });

    expect((await call('ask_human', question)).markedNeedsHuman).toBe(true);

    const stored = (await call('get_part', { mpn: 'TPS54331DR' })).part as { status: string };
    expect(stored.status).toBe('needs_human');
  });

  it('marks nothing when a person is watching', async () => {
    const watched = await createHarness({ headless: false });
    try {
      watched.context.repositories.parts.upsertPart(part());
      const result = (await registry.call('ask_human', question, watched.context)) as {
        markedNeedsHuman: boolean;
      };
      expect(result.markedNeedsHuman).toBe(false);
      expect(watched.context.repositories.parts.getPart('TPS54331DR')?.status).toBe('extracted');
    } finally {
      await watched.close();
    }
  });

  it('marks a part already needing a person only once', async () => {
    await call('upsert_part', { part: part({ status: 'needs_human' }) });
    expect((await call('ask_human', question)).markedNeedsHuman).toBe(false);
  });

  it('filters escalations by kind and limit', async () => {
    await call('ask_human', question);
    await call('ask_human', { ...question, kind: 'other', question: 'Something else entirely?' });

    expect(
      ((await call('list_escalations', { kind: 'other' })).escalations as unknown[]).length,
    ).toBe(1);
    expect(((await call('list_escalations', { limit: 1 })).escalations as unknown[]).length).toBe(
      1,
    );
    expect(
      ((await call('list_escalations', { resolved: true })).escalations as unknown[]).length,
    ).toBe(0);
  });
});

describe('normalise_value', () => {
  it.each([
    ['3V3', 'V', { value: 3.3, unit: 'V' }],
    ['570 kHz', 'Hz', { value: 570_000, unit: 'Hz' }],
    ['70 µA', 'A', { value: 0.00007, unit: 'A' }],
  ])('reads %s as a quantity', async (text, unit, expected) => {
    expect(await call('normalise_value', { text, unit, kind: 'quantity' })).toEqual({
      kind: 'quantity',
      quantity: expected,
    });
  });

  it('reads a range', async () => {
    expect(
      await call('normalise_value', { text: '100kHz to 1.5MHz', unit: 'Hz', kind: 'range' }),
    ).toEqual({ kind: 'range', range: { unit: 'Hz', min: 100_000, max: 1_500_000 } });
  });

  it('reads a temperature range and the reference it is measured at', async () => {
    expect(
      await call('normalise_value', {
        text: '-40°C ~ 125°C (TJ)',
        unit: 'degC',
        kind: 'temperature_range',
      }),
    ).toEqual({
      kind: 'temperature_range',
      range: { unit: 'degC', min: -40, max: 125 },
      reference: 'junction',
    });
  });

  it('rejects text it cannot read rather than guessing', async () => {
    await expect(
      call('normalise_value', { text: 'about three volts', unit: 'V', kind: 'quantity' }),
    ).rejects.toMatchObject({ code: 'UNIT_PARSE_FAILED' });
  });

  it('rejects a value in the wrong unit family', async () => {
    await expect(
      call('normalise_value', { text: '3 A', unit: 'V', kind: 'quantity' }),
    ).rejects.toMatchObject({ code: 'UNIT_PARSE_FAILED' });
  });
});

describe('classify_part', () => {
  it('returns every axis for a complete parameter set', async () => {
    const result = await call('classify_part', { parameters: buckParameters() });
    expect((result.classifications as { axis: string }[]).map((c) => c.axis).sort()).toEqual([
      'features',
      'integration',
      'ioutClass',
      'outputType',
      'packageFamily',
      'temperatureGrade',
      'topology',
      'vinClass',
    ]);
    expect(result.undecided).toEqual([]);
  });

  it('names the axes it cannot decide instead of leaving them out', async () => {
    const result = await call('classify_part', { parameters: { vinMax: param(q(28, 'V')) } });
    expect((result.classifications as unknown[]).length).toBe(1);
    expect((result.undecided as { axis: string }[]).map((axis) => axis.axis)).toContain('features');
  });
});

describe('reconcile_parameters', () => {
  const sources = [
    {
      provenance: distributorProvenance(),
      facts: [{ kind: 'quantity', key: 'vinMax', value: q(36, 'V') }],
    },
  ];

  it('records a safety conflict, escalates it, and stores the question', async () => {
    const result = await call('reconcile_parameters', {
      mpn: 'TPS54331DR',
      parameters: buckParameters(),
      sources,
    });

    const vinMax = (result.parameters as { key: string; outcome: string }[]).find(
      (parameter) => parameter.key === 'vinMax',
    );
    expect(vinMax?.outcome).toBe('conflict');
    expect((result.escalations as unknown[]).length).toBe(1);
    expect(
      ((await call('list_escalations', { kind: 'conflict' })).escalations as unknown[]).length,
    ).toBe(1);
    const updated = result.updated as { vinMax: { confidence: string } };
    expect(updated.vinMax.confidence).toBe('conflict');
  });

  it('agrees without escalating when the distributor restates the datasheet', async () => {
    const result = await call('reconcile_parameters', {
      mpn: 'TPS54331DR',
      parameters: buckParameters(),
      sources: [
        {
          provenance: distributorProvenance(),
          facts: [{ kind: 'quantity', key: 'vinMax', value: q(28, 'V') }],
        },
      ],
    });
    expect(result.escalations).toEqual([]);
  });

  it('rejects a fact keyed to a parameter that does not exist', async () => {
    await expect(
      call('reconcile_parameters', {
        mpn: 'TPS54331DR',
        parameters: buckParameters(),
        sources: [
          {
            provenance: distributorProvenance(),
            facts: [{ kind: 'quantity', key: 'vinMaximum', value: q(36, 'V') }],
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('a run that may not spend', () => {
  it('denies a spending tool whatever the caller confirms', async () => {
    const denied = await createHarness({ policy: NO_SPEND_POLICY });
    try {
      const result = await registry.call(
        'fetch_offers',
        { mpn: 'TPS54331DR', confirmSpend: true },
        denied.context,
      );
      expect(result).toEqual({
        status: 'denied',
        tool: 'fetch_offers',
        reason: 'this run is not allowed to spend quota, confirmed or not',
      });
    } finally {
      await denied.close();
    }
  });
});
