import type { z } from 'zod';

import type { Cache } from '../cache/index.js';
import type { Repositories } from '../db/index.js';
import type { ToolCallLedger } from '../log/index.js';
import type { PdfToolkit } from '../pdf/index.js';
import type { DigiKeyApi } from '../adapters/digikey/index.js';
import type { MouserApi } from '../adapters/mouser/index.js';
import type { QuotaPolicy } from './policy.js';

/**
 * A block of tool output as MCP carries it. Only the two kinds this project
 * produces are modelled; the MCP adapter maps them to the protocol's own
 * types, so nothing below `src/mcp/` imports the SDK.
 */
export type ContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly data: string; readonly mimeType: string };

/** Everything a tool handler is allowed to touch. */
export interface ToolContext {
  readonly repositories: Repositories;
  readonly cache: Cache;
  readonly toolkit: PdfToolkit;
  /** Absent when no credentials are configured for that distributor. */
  readonly digikey?: DigiKeyApi | undefined;
  readonly mouser?: MouserApi | undefined;
  readonly ledger: ToolCallLedger;
  /**
   * The run these calls belong to, when they belong to one. A tool that
   * records who read something takes it from here rather than from the
   * model, which would be asking the reader to name itself.
   */
  readonly run?: { readonly promptVersion: string; readonly model: string } | undefined;
  readonly policy: QuotaPolicy;
  /**
   * No person is watching this run, so an escalation marks the part and the
   * run carries on rather than waiting for an answer that cannot come.
   */
  readonly headless: boolean;
  readonly now: () => string;
  readonly newId: () => string;
}

export interface ToolAnnotations {
  /** The tool changes nothing a later call could observe. */
  readonly readOnlyHint: boolean;
  /** The tool can overwrite or remove something that already exists. */
  readonly destructiveHint: boolean;
}

/**
 * A tool as the registry holds it: schemas, what it costs, and a handler
 * erased to `unknown` in and `unknown` out.
 *
 * The erasure is what lets tools of different shapes live in one registry
 * without a cast. `defineTool` closes over the typed handler and parses the
 * input inside `run`, so the types are checked where the handler is written
 * and the registry only has to know that both ends are validated.
 */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly input: z.ZodType;
  readonly output: z.ZodType;
  /** The tool can spend API quota or money, so the policy gates it. */
  readonly spendsQuota: boolean;
  readonly annotations: ToolAnnotations;
  readonly run: (input: unknown, context: ToolContext) => Promise<unknown>;
  /** How the output is shown to a model. Defaults to JSON text. */
  readonly content?: (output: unknown) => readonly ContentBlock[];
}
