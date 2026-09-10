import { describe, it } from 'vitest';

import { OTHER_UUID, toolCallRecord } from '../../test/helpers/core-fixtures.js';
import { expectAccepts, expectRejects } from '../../test/helpers/schema.js';
import { ErrorJson, ToolCallRecord } from './tool-call-record.js';

const errorJson = {
  name: 'GateError',
  code: 'GATE_ROOT_MISSING',
  message: 'gate root does not exist: nope',
  details: { root: 'nope' },
};

describe('ErrorJson', () => {
  it('accepts a serialised error with or without a cause', () => {
    expectAccepts(ErrorJson, errorJson);
    expectAccepts(ErrorJson, { ...errorJson, cause: { name: 'Error', message: 'ENOENT' } });
    expectAccepts(ErrorJson, { ...errorJson, cause: null });
  });

  it.each([
    ['an empty code', { ...errorJson, code: '' }],
    ['non-JSON details', { ...errorJson, details: { at: 1n } }],
    ['a stack', { ...errorJson, stack: 'Error: ...' }],
  ])('rejects %s', (_label, value) => {
    expectRejects(ErrorJson, value);
  });
});

describe('ToolCallRecord', () => {
  it('accepts a record with output, and one with an error instead', () => {
    expectAccepts(ToolCallRecord, toolCallRecord());
    const { output: _output, ...rest } = toolCallRecord();
    expectAccepts(ToolCallRecord, { ...rest, error: errorJson });
  });

  it('accepts a parent id, a null output, and a quota-spending call', () => {
    expectAccepts(
      ToolCallRecord,
      toolCallRecord({ parentId: OTHER_UUID, output: null, spendsQuota: true }),
    );
  });

  it('rejects a record with both output and error', () => {
    expectRejects(ToolCallRecord, toolCallRecord({ error: errorJson }), 'error');
  });

  it('rejects a record with neither output nor error', () => {
    const { output: _output, ...rest } = toolCallRecord();
    expectRejects(ToolCallRecord, rest, 'output');
  });

  it.each([
    ['a non-UUID id', toolCallRecord({ id: 'call-1' })],
    ['a non-UUID parent', toolCallRecord({ parentId: 'call-0' })],
    ['an empty session', toolCallRecord({ sessionId: ' ' })],
    ['a camelCase tool name', toolCallRecord({ tool: 'readPages' })],
    ['a tool name starting with a digit', toolCallRecord({ tool: '1read' })],
    ['non-JSON input', toolCallRecord({ input: { when: 1n } })],
    ['a negative duration', toolCallRecord({ durationMs: -1 })],
    ['a fractional duration', toolCallRecord({ durationMs: 1.5 })],
    [
      'a missing spendsQuota',
      (() => {
        const { spendsQuota: _spends, ...rest } = toolCallRecord();
        return rest;
      })(),
    ],
    ['an extra key', toolCallRecord({ cost: 0.01 })],
  ])('rejects %s', (_label, value) => {
    expectRejects(ToolCallRecord, value);
  });
});
