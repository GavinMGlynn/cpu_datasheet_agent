import { ChipAgentError } from '../errors.js';

/**
 * Every deliberate failure from the MPN module.
 *
 * | Code | Meaning |
 * | --- | --- |
 * | `MPN_EMPTY` | The raw part number held nothing once trimmed. |
 * | `MPN_INVALID` | Normalisation produced something the `NormalisedMpn` schema rejects. |
 * | `MPN_TOO_LONG` | Longer than the 64 characters the schema allows. |
 * | `MPN_TABLE_MISSING` | A decoder matched a code its own table does not hold, which means the pattern and the table have drifted apart. |
 * | `MPN_NO_DECODER` | No decoder claims the manufacturer or the part number. |
 */
export class MpnError extends ChipAgentError {}
