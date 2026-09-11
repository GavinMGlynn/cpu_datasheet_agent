import { ChipAgentError } from '../errors.js';

/**
 * Every deliberate failure from the classify module.
 *
 * | Code | Meaning |
 * | --- | --- |
 * | `CLASSIFY_INCOMPLETE` | One or more axes could not be decided: a parameter they need is absent, or its value decides no value on that axis. The error lists every axis with the reason. |
 */
export class ClassifyError extends ChipAgentError {}
