import { ChipAgentError } from '../errors.js';

/**
 * Every deliberate failure from the reconcile module.
 *
 * | Code | Meaning |
 * | --- | --- |
 * | `RECONCILE_SHAPE_MISMATCH` | A distributor fact cannot be compared with the parameter it is keyed to — a boolean against a voltage, say. The mapping table that produced it is wrong, so this is loud rather than silently dropped. |
 *
 * A unit that does not match the parameter's own raises `UnitMismatchError`
 * from `src/units/`, which is already coded and carries both units.
 */
export class ReconcileError extends ChipAgentError {}
