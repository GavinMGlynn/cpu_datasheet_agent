import { ChipAgentError } from '../errors.js';

/**
 * Every deliberate failure from the tool layer.
 *
 * | Code | Meaning |
 * | --- | --- |
 * | `TOOL_DUPLICATE` | Two tools registered under one name. A programming error, raised at registration rather than at call time. |
 * | `TOOL_UNKNOWN` | A call for a name the registry does not hold. |
 * | `TOOL_OUTPUT_INVALID` | A handler returned something its own output schema rejects. The handler is wrong, so this is loud. |
 * | `TOOL_UNAVAILABLE` | The tool needs something this run was not given: a distributor with no credentials configured, most often. |
 * | `TOOL_NOT_FOUND` | The call named something that is not stored: a datasheet digest, a part, an escalation. |
 */
export class ToolError extends ChipAgentError {}
