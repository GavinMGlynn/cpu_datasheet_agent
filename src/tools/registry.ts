import type { z } from 'zod';

import { ValidationError, parseOrThrow } from '../core/index.js';
import { withLedger } from '../log/index.js';
import { ToolError } from './errors.js';
import type { ContentBlock, ToolAnnotations, ToolContext, ToolDefinition } from './types.js';

export interface ToolSpec<I extends z.ZodType, O extends z.ZodType> {
  readonly name: string;
  readonly description: string;
  readonly input: I;
  readonly output: O;
  /** Defaults to false: a tool spends quota only by saying so. */
  readonly spendsQuota?: boolean;
  readonly annotations: ToolAnnotations;
  readonly handler: (input: z.output<I>, context: ToolContext) => Promise<z.output<O>>;
  readonly content?: (output: z.output<O>) => readonly ContentBlock[];
}

/**
 * Builds a {@link ToolDefinition} from a typed specification.
 *
 * The handler is written against its own schemas and `run` parses the input
 * before calling it, so a tool is type-checked where it is written and erased
 * where it is stored. No cast is involved: `run` closes over the typed
 * handler rather than pretending to be it.
 */
export function defineTool<I extends z.ZodType, O extends z.ZodType>(
  spec: ToolSpec<I, O>,
): ToolDefinition {
  const definition: ToolDefinition = {
    name: spec.name,
    description: spec.description,
    input: spec.input,
    output: spec.output,
    spendsQuota: spec.spendsQuota ?? false,
    annotations: spec.annotations,
    run: async (raw, context) =>
      spec.handler(parseOrThrow(spec.input, raw, `${spec.name} input`), context),
  };
  const { content } = spec;
  if (content === undefined) {
    return definition;
  }
  // The output is parsed again on the way out: whatever calls this has the
  // validated result already, and re-proving it costs less than a way for an
  // unvalidated one to reach a renderer.
  return {
    ...definition,
    content: (output: unknown): readonly ContentBlock[] =>
      content(parseOrThrow(spec.output, output, `${spec.name} output`)),
  };
}

/**
 * The tool surface: every handler, validated on both sides and recorded.
 *
 * Registration refuses duplicate names, because two tools answering to one
 * name is a wiring mistake that would otherwise show up as the wrong one
 * running. Calls go through the ledger whatever the transport, so the record
 * is the same whether the caller was the agent runner or an MCP client.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  add(tool: ToolDefinition): this {
    if (this.tools.has(tool.name)) {
      throw new ToolError('TOOL_DUPLICATE', `tool ${tool.name} is already registered`, {
        details: { name: tool.name },
      });
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  addAll(tools: Iterable<ToolDefinition>): this {
    for (const tool of tools) {
      this.add(tool);
    }
    return this;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): ToolDefinition {
    const tool = this.tools.get(name);
    if (tool === undefined) {
      throw new ToolError('TOOL_UNKNOWN', `no tool named ${name}`, {
        details: { name, known: this.names() },
      });
    }
    return tool;
  }

  /** Every tool, in name order, so two adapters list them the same way. */
  list(): readonly ToolDefinition[] {
    return [...this.tools.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  names(): readonly string[] {
    return this.list().map((tool) => tool.name);
  }

  /**
   * Runs one tool: input parsed, handler called, output parsed, the whole
   * thing recorded in the ledger under the tool's name.
   *
   * Throws `ValidationError` when the caller's input is rejected and
   * `ToolError` `TOOL_OUTPUT_INVALID` when the handler's own output is — the
   * two are different faults and are worth telling apart.
   */
  async call(
    name: string,
    input: unknown,
    context: ToolContext,
    parentId?: string,
  ): Promise<unknown> {
    const tool = this.get(name);
    const run = withLedger(
      context.ledger,
      { name: tool.name, spendsQuota: tool.spendsQuota },
      async (raw: unknown) => {
        const output = await tool.run(raw, context);
        try {
          return parseOrThrow(tool.output, output, `${tool.name} output`);
        } catch (error) {
          if (error instanceof ValidationError) {
            throw new ToolError(
              'TOOL_OUTPUT_INVALID',
              `${tool.name} returned a result its own output schema rejects`,
              { cause: error, details: { tool: tool.name, issues: error.issues } },
            );
          }
          throw error;
        }
      },
    );
    return parentId === undefined ? run(input) : run(input, parentId);
  }
}
