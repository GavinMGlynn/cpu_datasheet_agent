import { ChipAgentError } from '../../errors.js';

/**
 * Every deliberate failure from the Mouser adapter.
 *
 * | Code | Meaning |
 * | --- | --- |
 * | `MOUSER_KEY_MISSING` | `MOUSER_API_KEY` is unset. |
 * | `MOUSER_REQUEST_FAILED` | Unexpected status, or the network failed. |
 * | `MOUSER_API_ERROR` | The body carried an `Errors` array. Mouser reports failures this way with HTTP 200, so status alone never means success. |
 * | `MOUSER_RATE_LIMITED` | 429 after every retry. |
 * | `MOUSER_RESPONSE_INVALID` | The body did not match the expected schema. |
 * | `MOUSER_NOT_FOUND` | The search returned no parts. |
 */
export class MouserError extends ChipAgentError {}
