/**
 * Stored vocabulary, as a person would write it.
 *
 * The database speaks `needs_human` and `integrated_fet` because a schema
 * wants one spelling and no spaces. A page that repeats that is showing its
 * plumbing, so every enumerated value passes through here on the way out.
 *
 * Unknown values are humanised rather than hidden: a value this table has
 * never seen still has to read as words, because the alternative is a blank
 * cell where the truth was.
 */

const WORDS: Readonly<Record<string, string>> = Object.freeze({
  // Part status and run results.
  extracted: 'Extracted',
  verified: 'Verified',
  needs_human: 'Needs a person',
  rejected: 'Rejected',
  unfinished: 'Unfinished',
  // Verdicts.
  confirmed: 'Confirmed',
  not_found: 'Not found',
  contradicted: 'Contradicted',
  unchecked: 'Not checked',
  // Confidence.
  conflict: 'In conflict',
  derived: 'Derived',
  // Run kinds.
  extract: 'Extraction',
  verify: 'Verification',
  evaluate: 'Evaluation',
  // Launch state.
  running: 'Running',
  finished: 'Finished',
  cancelled: 'Cancelled',
  failed: 'Failed',
  queued: 'Queued',
  // Provenance.
  datasheet: 'Datasheet',
  distributor: 'Distributor',
  human: 'A person',
  digikey: 'Digi-Key',
  mouser: 'Mouser',
  nexar: 'Nexar',
  farnell: 'Farnell',
  // Parameter vocabulary.
  synchronous: 'Synchronous',
  non_synchronous: 'Non-synchronous',
  integrated_fet: 'Integrated FET',
  controller: 'Controller',
  adjustable: 'Adjustable',
  fixed: 'Fixed',
  buck_regulator: 'Buck regulator',
  none: 'None',
  pfm: 'PFM',
  pulse_skipping: 'Pulse skipping',
  forced_pwm: 'Forced PWM',
});

/** One stored value, as words. */
export function label(value: string): string {
  const known = WORDS[value];
  if (known !== undefined) {
    return known;
  }
  const words = value.replace(/_/gu, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The same, for a value that may be absent. */
export function labelOr(value: string | null | undefined, fallback = '—'): string {
  return value === null || value === undefined || value === '' ? fallback : label(value);
}
