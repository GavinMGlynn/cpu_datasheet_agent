import type { PackageFamily } from '../core/classification.js';
import type { Packaging } from '../core/offer.js';
import { group, optionalGroup } from '../util/regex.js';
import { MpnError } from './errors.js';
import type {
  DecodedMpn,
  ManufacturerKey,
  PackageInfo,
  TemperatureGrade,
  TemperatureRange,
} from './types.js';

export interface PackageSpec {
  readonly code: string;
  /** Null when the code covers more than one package shape. */
  readonly family: PackageFamily | null;
  readonly description: string;
  /** Only when the code fixes the pin count for every part that carries it. */
  readonly pins: number | null;
}

export interface GradeSpec {
  readonly code: string;
  /** The operating range the grade covers. */
  readonly range: TemperatureRange | null;
  /** The part of it the manufacturer tests, stated even when it is the same. */
  readonly guaranteed: TemperatureRange | null;
}

export interface PackagingSpec {
  readonly code: string;
  readonly packaging: Packaging;
}

export interface LeadFinishSpec {
  readonly code: string;
  readonly finish: string;
}

/**
 * One element of a part number, in the order the manufacturer writes them.
 *
 * Every segment is matched against a table the corpus proves, so a suffix is
 * either consumed entirely by known codes or not decoded at all.
 */
export type Segment =
  /** The device identity. The only segment whose pattern is written by hand. */
  | { readonly kind: 'base'; readonly pattern: string }
  | { readonly kind: 'package'; readonly optional?: boolean }
  | { readonly kind: 'grade'; readonly optional?: boolean }
  | { readonly kind: 'packaging'; readonly optional?: boolean }
  | { readonly kind: 'leadFinish'; readonly optional?: boolean }
  /** A fixed string that may carry a meaning of its own. */
  | {
      readonly kind: 'literal';
      readonly text: string;
      readonly optional?: boolean;
      readonly automotive?: boolean;
      readonly leadFinish?: string;
      readonly packaging?: Packaging;
      readonly extra?: string;
    }
  /**
   * Recognised free text with no field of its own; recorded in `extras`.
   *
   * The pattern carries its own quantifier, lazy included: an option that
   * should give way to the segment after it is written `[A-Z]{0,2}?`, so the
   * engine never has to guess which part of a pattern to weaken.
   */
  | {
      readonly kind: 'option';
      readonly pattern: string;
      readonly label: string;
      /**
       * Whether the code changes which part you receive. A version letter or
       * a fixed output voltage does, and joins the base part; a value-added
       * option or a RoHS marker does not, and is only recorded. Identity is
       * the default, because a code nobody has explained is safer treated as
       * a different part than as the same one.
       */
      readonly role?: 'identity' | 'decoration';
    };

export interface DecoderForm {
  readonly segments: readonly Segment[];
  readonly packages?: readonly PackageSpec[];
  readonly grades?: readonly GradeSpec[];
  readonly packagings?: readonly PackagingSpec[];
  readonly leadFinishes?: readonly LeadFinishSpec[];
  /** Packaging when the part number states none. */
  readonly defaultPackaging?: Packaging;
}

export interface DecoderSpec {
  readonly manufacturer: ManufacturerKey;
  /** Manufacturer names, as distributors spell them, that this decoder covers. */
  readonly names: readonly RegExp[];
  /** Tried in order; the first form that consumes the whole part number wins. */
  readonly forms: readonly DecoderForm[];
}

export interface Decoder {
  readonly manufacturer: ManufacturerKey;
  /** True when the distributor's manufacturer name belongs to this decoder. */
  claims(manufacturerName: string): boolean;
  decode(mpn: string): DecodedMpn | null;
}

/** Escapes the characters that appear in real part-number codes. */
export function escapeCode(code: string): string {
  return code.replace(/[.+*?^$()[\]{}|\\#-]/g, '\\$&');
}

/**
 * An alternation of codes, longest first.
 *
 * Order matters: with `D` before `DDA` the engine would match `D` and leave
 * `DA` for the next segment, turning one package code into another.
 */
export function alternation(codes: readonly string[]): string {
  return [...codes]
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .map(escapeCode)
    .join('|');
}

/** The segment kinds whose codes come from a table. */
type TableKind = 'package' | 'grade' | 'packaging' | 'leadFinish';

function tableFor(form: DecoderForm, kind: TableKind): readonly { code: string }[] | undefined {
  switch (kind) {
    case 'package':
      return form.packages;
    case 'grade':
      return form.grades;
    case 'packaging':
      return form.packagings;
    case 'leadFinish':
      return form.leadFinishes;
  }
}

/**
 * Reads a code the pattern already matched.
 *
 * The pattern is built from this table, so a missing entry means the two have
 * been allowed to drift apart. That is a defect in the decoder rather than in
 * the part number, and it throws instead of quietly yielding no package.
 */
function find<T extends { code: string }>(
  table: readonly T[] | undefined,
  code: string,
  kind: string,
): T {
  const entry = table?.find((candidate) => candidate.code === code);
  if (entry === undefined) {
    throw new MpnError('MPN_TABLE_MISSING', `no ${kind} entry for the code ${code}`, {
      details: { kind, code },
    });
  }
  return entry;
}

interface CompiledForm {
  readonly pattern: RegExp;
  readonly segments: readonly Segment[];
  readonly form: DecoderForm;
}

function compileForm(form: DecoderForm): CompiledForm {
  let source = '^';
  for (const segment of form.segments) {
    switch (segment.kind) {
      case 'base':
        source += `(${segment.pattern})`;
        break;
      case 'option':
        source += `(${segment.pattern})`;
        break;
      case 'literal':
        source += `(${escapeCode(segment.text)})${segment.optional === true ? '?' : ''}`;
        break;
      case 'package':
      case 'grade':
      case 'packaging':
      case 'leadFinish': {
        const table = tableFor(form, segment.kind);
        if (table === undefined || table.length === 0) {
          throw new MpnError(
            'MPN_TABLE_MISSING',
            `a ${segment.kind} segment needs a non-empty table`,
            { details: { kind: segment.kind } },
          );
        }
        source += `(${alternation(table.map((entry) => entry.code))})${
          segment.optional === true ? '?' : ''
        }`;
      }
    }
  }
  return { pattern: new RegExp(`${source}$`), segments: form.segments, form };
}

interface Accumulator {
  family: string;
  identity: string[];
  package: PackageInfo | null;
  temperatureGrade: TemperatureGrade | null;
  packaging: Packaging | null;
  leadFinish: string | null;
  automotive: boolean;
  extras: string[];
}

function applySegment(
  segment: Segment,
  match: RegExpExecArray,
  index: number,
  form: DecoderForm,
  accumulator: Accumulator,
): void {
  switch (segment.kind) {
    case 'base':
      accumulator.family = group(match, index);
      break;
    case 'option': {
      const text = group(match, index);
      if (text === '') {
        break;
      }
      if (segment.role === 'decoration') {
        accumulator.extras.push(`${segment.label}:${text}`);
      } else {
        // Leading hyphens are dropped so one joiner is used throughout.
        accumulator.identity.push(text.replace(/^-+/, ''));
      }
      break;
    }
    case 'literal': {
      if (optionalGroup(match, index) === undefined) {
        break;
      }
      if (segment.automotive === true) {
        accumulator.automotive = true;
      }
      if (segment.leadFinish !== undefined) {
        accumulator.leadFinish = segment.leadFinish;
      }
      if (segment.packaging !== undefined) {
        accumulator.packaging = segment.packaging;
      }
      if (segment.extra !== undefined) {
        accumulator.extras.push(segment.extra);
      }
      break;
    }
    case 'package': {
      const code = optionalGroup(match, index);
      if (code !== undefined) {
        const { family, description, pins } = find(form.packages, code, 'package');
        accumulator.package = { code, family, description, pins };
      }
      break;
    }
    case 'grade': {
      const code = optionalGroup(match, index);
      if (code !== undefined) {
        const { range, guaranteed } = find(form.grades, code, 'grade');
        accumulator.temperatureGrade = { code, range, guaranteed };
      }
      break;
    }
    case 'packaging': {
      const code = optionalGroup(match, index);
      if (code !== undefined) {
        accumulator.packaging = find(form.packagings, code, 'packaging').packaging;
      }
      break;
    }
    case 'leadFinish': {
      const code = optionalGroup(match, index);
      if (code !== undefined) {
        accumulator.leadFinish = find(form.leadFinishes, code, 'lead finish').finish;
      }
      break;
    }
  }
}

/**
 * Turns a declarative specification into a decoder.
 *
 * The pattern is built from the same tables the decode reads, so the two
 * cannot drift: a code the pattern matches is a code the table holds.
 */
export function compileDecoder(spec: DecoderSpec): Decoder {
  const compiled = spec.forms.map(compileForm);
  return {
    manufacturer: spec.manufacturer,
    claims: (manufacturerName: string): boolean =>
      spec.names.some((name) => name.test(manufacturerName)),
    decode: (mpn: string): DecodedMpn | null => {
      for (const { pattern, segments, form } of compiled) {
        const match = pattern.exec(mpn);
        if (match === null) {
          continue;
        }
        const accumulator: Accumulator = {
          family: '',
          identity: [],
          package: null,
          temperatureGrade: null,
          packaging: null,
          leadFinish: null,
          automotive: false,
          extras: [],
        };
        segments.forEach((segment, position) => {
          applySegment(segment, match, position + 1, form, accumulator);
        });
        return {
          mpn,
          manufacturer: spec.manufacturer,
          family: accumulator.family,
          basePart: [accumulator.family, ...accumulator.identity].join('-'),
          package: accumulator.package,
          temperatureGrade: accumulator.temperatureGrade,
          packaging: accumulator.packaging ?? form.defaultPackaging ?? 'unknown',
          leadFinish: accumulator.leadFinish,
          automotive: accumulator.automotive,
          extras: accumulator.extras,
        };
      }
      return null;
    },
  };
}
