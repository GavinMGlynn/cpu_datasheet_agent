import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createHarness, type TestHarness } from '../../test/helpers/tool-context.js';
import { ValidationError } from '../core/index.js';
import { ToolError } from './errors.js';
import { ToolRegistry, defineTool } from './registry.js';
import type { ToolContext } from './types.js';

const ANNOTATIONS = { readOnlyHint: true, destructiveHint: false } as const;

const echo = defineTool({
  name: 'echo',
  description: 'Returns what it was given.',
  input: z.strictObject({ text: z.string().min(1) }),
  output: z.strictObject({ text: z.string() }),
  annotations: ANNOTATIONS,
  handler: (input) => Promise.resolve({ text: input.text }),
});

const liar = defineTool({
  name: 'liar',
  description: 'Returns something its own output schema rejects.',
  input: z.strictObject({}),
  output: z.strictObject({ count: z.number() }),
  annotations: ANNOTATIONS,
  handler: () => Promise.resolve({ count: 'three' } as never),
});

const thrower = defineTool({
  name: 'thrower',
  description: 'Fails on purpose.',
  input: z.strictObject({}),
  output: z.strictObject({}),
  annotations: ANNOTATIONS,
  handler: () => Promise.reject(new ToolError('TOOL_NOT_FOUND', 'nothing here')),
});

let harness: TestHarness;
let context: ToolContext;

beforeEach(async () => {
  harness = await createHarness();
  context = harness.context;
});

afterEach(async () => {
  await harness.close();
});

describe('defineTool', () => {
  it('defaults to not spending quota', () => {
    expect(echo.spendsQuota).toBe(false);
    expect(
      defineTool({ ...echo, spendsQuota: true, handler: () => Promise.resolve({ text: '' }) })
        .spendsQuota,
    ).toBe(true);
  });

  it('parses the input before the handler sees it', async () => {
    await expect(echo.run({ text: 'hello' }, context)).resolves.toEqual({ text: 'hello' });
    await expect(echo.run({ text: '' }, context)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('ToolRegistry', () => {
  it('refuses two tools with one name', () => {
    const registry = new ToolRegistry().add(echo);
    expect(() => registry.add(echo)).toThrow(ToolError);
    expect(() => registry.add(echo)).toThrow(/already registered/);
  });

  it('refuses a call for a name it does not hold', async () => {
    const registry = new ToolRegistry().add(echo);
    expect(registry.has('echo')).toBe(true);
    expect(registry.has('nope')).toBe(false);
    await expect(registry.call('nope', {}, context)).rejects.toMatchObject({
      code: 'TOOL_UNKNOWN',
    });
  });

  it('lists tools in name order whatever order they were added', () => {
    const registry = new ToolRegistry().addAll([thrower, echo, liar]);
    expect(registry.names()).toEqual(['echo', 'liar', 'thrower']);
  });

  it('rejects input the tool does not accept, and records the attempt', async () => {
    const registry = new ToolRegistry().add(echo);

    await expect(registry.call('echo', { text: 42 }, context)).rejects.toBeInstanceOf(
      ValidationError,
    );

    const [record] = await harness.ledgerRecords();
    expect(record?.tool).toBe('echo');
    expect(record?.input).toEqual({ text: 42 });
    expect(record?.error).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('treats a handler breaking its own output schema as a defect of its own', async () => {
    const registry = new ToolRegistry().add(liar);

    await expect(registry.call('liar', {}, context)).rejects.toMatchObject({
      code: 'TOOL_OUTPUT_INVALID',
    });

    const [record] = await harness.ledgerRecords();
    expect(record?.error).toMatchObject({ code: 'TOOL_OUTPUT_INVALID' });
  });

  it('lets an error that is not a validation failure through unchanged', async () => {
    const exploding = defineTool({
      name: 'exploding',
      description: 'Has an output schema that throws rather than rejecting.',
      input: z.strictObject({}),
      output: z.strictObject({}).superRefine(() => {
        throw new RangeError('the schema itself broke');
      }),
      annotations: ANNOTATIONS,
      handler: () => Promise.resolve({}),
    });
    const registry = new ToolRegistry().add(exploding);

    await expect(registry.call('exploding', {}, context)).rejects.toBeInstanceOf(RangeError);
  });

  it('records one call per invocation, with its output', async () => {
    const registry = new ToolRegistry().add(echo);

    await registry.call('echo', { text: 'one' }, context);
    await registry.call('echo', { text: 'two' }, context);

    const records = await harness.ledgerRecords();
    expect(records).toHaveLength(2);
    expect(records.map((record) => record.output)).toEqual([{ text: 'one' }, { text: 'two' }]);
    expect(records.every((record) => !record.spendsQuota)).toBe(true);
  });

  it('records a call under its parent when one is given', async () => {
    const registry = new ToolRegistry().add(echo);

    const parentId = '11111111-2222-4333-8444-555555555555';
    await registry.call('echo', { text: 'child' }, context, parentId);

    const [record] = await harness.ledgerRecords();
    expect(record?.parentId).toBe('11111111-2222-4333-8444-555555555555');
  });

  it('lets a tool error through unchanged', async () => {
    const registry = new ToolRegistry().add(thrower);
    await expect(registry.call('thrower', {}, context)).rejects.toMatchObject({
      code: 'TOOL_NOT_FOUND',
    });
  });
});
