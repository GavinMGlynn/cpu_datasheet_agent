import { ChipAgentError } from '../../errors.js';

/**
 * Every deliberate failure from the Digi-Key adapter.
 *
 * | Code | Meaning |
 * | --- | --- |
 * | `DIGIKEY_CREDENTIALS_MISSING` | `DIGIKEY_CLIENT_ID` or `DIGIKEY_CLIENT_SECRET` is unset. |
 * | `DIGIKEY_TOKEN_FAILED` | The token endpoint refused the credentials or was unreachable. |
 * | `DIGIKEY_REQUEST_FAILED` | The API returned an unexpected status, or the network failed. |
 * | `DIGIKEY_RATE_LIMITED` | 429 after every retry; `details.retryAfterSeconds` when the API said. |
 * | `DIGIKEY_NOT_FOUND` | 404: Digi-Key does not list the part. |
 * | `DIGIKEY_RESPONSE_INVALID` | The body did not match the expected schema. |
 */
export class DigiKeyError extends ChipAgentError {}
