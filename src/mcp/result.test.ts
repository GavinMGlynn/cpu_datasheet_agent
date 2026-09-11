import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ChipAgentError } from '../errors.js';
import { defineTool, spendable } from '../tools/index.js';
import { isObjectSchema, jsonBlock, toCallResult, toErrorResult } from './result.js';

const ANNOTATIONS = { readOnlyHint: true, destructiveHint: false } as const;

const objectTool = defineTool({
  name: 'object_tool',
  description: 'Answers with an object.',
  input: z.strictObject({}),
  output: z.strictObject({ answer: z.number() }),
  annotations: ANNOTATIONS,
  handler: () => Promise.resolve({ answer: 42 }),
});

const spendingTool = defineTool({
  name: 'spending_tool',
  description: 'Answers with a result or a request to confirm.',
  input: z.strictObject({}),
  output: spendable(z.strictObject({ answer: z.number() })),
  annotations: ANNOTATIONS,
  handler: () => Promise.resolve({ status: 'ok' as const, answer: 42 }),
});

describe('toCallResult', () => {
  it('carries an object output as structured content and as text', () => {
    const result = toCallResult(objectTool, { answer: 42 });
    expect(result.structuredContent).toEqual({ answer: 42 });
    expect(result.content).toEqual([jsonBlock({ answer: 42 })]);
  });

  it('carries a union output as text alone, having nothing to declare it against', () => {
    const result = toCallResult(spendingTool, { status: 'ok', answer: 42 });
    expect(result.structuredContent).toBeUndefined();
    expect(result.content[0]?.type).toBe('text');
  });

  it('uses the tool’s own renderer when it has one', () => {
    const rendered = defineTool({
      name: 'rendered',
      description: 'Answers with a picture.',
      input: z.strictObject({}),
      output: z.strictObject({ data: z.string() }),
      annotations: ANNOTATIONS,
      handler: () => Promise.resolve({ data: 'AAAA' }),
      content: (output) => [{ type: 'image', data: output.data, mimeType: 'image/png' }],
    });

    expect(toCallResult(rendered, { data: 'AAAA' }).content).toEqual([
      { type: 'image', data: 'AAAA', mimeType: 'image/png' },
    ]);
  });
});

/** The text of a block, for a result known to carry one. */
function textOf(result: { content: { type: string }[] }): string {
  const block = result.content[0];
  return block?.type === 'text' && 'text' in block ? String(block.text) : '';
}

describe('toErrorResult', () => {
  it('carries the code of one of our errors', () => {
    const result = toErrorResult(
      new ChipAgentError('SOME_CODE', 'it went wrong', { details: { a: 1 } }),
    );
    expect(result.isError).toBe(true);
    expect(JSON.parse(textOf(result))).toEqual({
      name: 'ChipAgentError',
      code: 'SOME_CODE',
      message: 'it went wrong',
      details: { a: 1 },
    });
  });

  it('describes anything else without losing it', () => {
    expect(JSON.parse(textOf(toErrorResult('a bare string')))).toEqual({
      name: 'Error',
      code: 'UNKNOWN',
      message: 'a bare string',
      details: {},
    });
  });
});

describe('isObjectSchema', () => {
  it('tells an object schema from a union of them', () => {
    expect(isObjectSchema(z.strictObject({}))).toBe(true);
    expect(isObjectSchema(spendable(z.strictObject({})))).toBe(false);
    expect(isObjectSchema(z.string())).toBe(false);
  });
});
