import type { BuckRegulatorParameters } from '../core/buck-regulator.js';
import type { DistributorProvenance } from '../core/provenance.js';
import type { ObservedValue } from '../core/observation.js';
import type { ParameterKey } from '../core/parameter-keys.js';

/** Any value a parameter can hold, at the types the schema pins them to. */
export type ParameterValue = BuckRegulatorParameters[ParameterKey]['value'];

/**
 * The parameters extraction has produced. Partial: reconciliation runs on
 * whatever is there, and a parameter nobody extracted is reported as
 * `distributor_only` rather than invented.
 */
export type ParameterSet = Partial<BuckRegulatorParameters>;

/** One distributor's parametric facts, with the provenance they carry. */
export interface DistributorParametrics {
  readonly provenance: DistributorProvenance;
  readonly facts: readonly (ObservedValue & { readonly key: ParameterKey })[];
}

/** One distributor value and where it came from. */
export interface Observation {
  readonly observed: ObservedValue;
  readonly provenance: DistributorProvenance;
}
