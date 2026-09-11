import { ToolRegistry } from '../registry.js';
import type { ToolDefinition } from '../types.js';
import { DISTRIBUTOR_TOOLS } from './distributor-tools.js';
import { HUMAN_TOOLS } from './human-tools.js';
import { MPN_TOOLS } from './mpn-tools.js';
import { OPS_TOOLS } from './ops-tools.js';
import { PART_TOOLS } from './part-tools.js';
import { PDF_TOOLS } from './pdf-tools.js';
import { VALUE_TOOLS } from './value-tools.js';

export * from './distributor-tools.js';
export * from './human-tools.js';
export * from './mpn-tools.js';
export * from './ops-tools.js';
export * from './part-tools.js';
export * from './pdf-tools.js';
export * from './value-tools.js';

/** Every tool, in the order the pipeline uses them. */
export const ALL_TOOLS: readonly ToolDefinition[] = Object.freeze([
  ...MPN_TOOLS,
  ...DISTRIBUTOR_TOOLS,
  ...PDF_TOOLS,
  ...VALUE_TOOLS,
  ...PART_TOOLS,
  ...HUMAN_TOOLS,
  ...OPS_TOOLS,
]);

/**
 * The complete tool surface.
 *
 * One registry is what makes the stdio server and the in-process server the
 * same surface rather than two that look alike.
 */
export function buildRegistry(tools: readonly ToolDefinition[] = ALL_TOOLS): ToolRegistry {
  return new ToolRegistry().addAll(tools);
}
