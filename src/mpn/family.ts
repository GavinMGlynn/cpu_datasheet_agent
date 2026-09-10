import type { PdfRef, SectionMatches } from '../pdf/toolkit.js';
import { SECTION_PATTERNS } from '../pdf/section-patterns.js';
import { decoderByKey } from './decoders/index.js';
import type { DecodedMpn } from './types.js';

/**
 * Runs of the characters part numbers are made of, long enough to be one.
 *
 * The alphabet is exactly the one `NormalisedMpn` allows, and the length fits
 * inside it, so a token is already a canonical part number: there is nothing
 * to normalise here and nothing that can fail. `family.test.ts` holds that
 * claim to a test.
 */
export const TOKEN = /[A-Z0-9][A-Z0-9./+#-]{3,63}/g;
/** Table rules and sentence ends cling to the token; they are not part of it. */
const TRAILING = /[-./]+$/;

/** One page of extracted text. Structural, so a test needs no toolkit. */
export interface PageTextLike {
  readonly page: number;
  readonly text: string;
}

export interface OrderingMpn {
  readonly mpn: string;
  /** The page it was first seen on, which is where a reader would check it. */
  readonly page: number;
}

/**
 * The part numbers an ordering table lists for one family.
 *
 * Only tokens that decode with the reference part's own decoder, and land in
 * the same family, are returned. That keeps a competitor's part number quoted
 * in a comparison table, a package drawing code, and a document number out of
 * the family list, and it is why a decoder returning null for an unreadable
 * suffix matters here: an undecodable token is simply not linked.
 */
export function orderingMpnsFrom(
  pages: readonly PageTextLike[],
  reference: DecodedMpn,
): readonly OrderingMpn[] {
  const decoder = decoderByKey(reference.manufacturer);
  const found = new Map<string, OrderingMpn>();
  for (const page of pages) {
    for (const raw of page.text.toUpperCase().match(TOKEN) ?? []) {
      const mpn = raw.replace(TRAILING, '');
      const decoded = decoder.decode(mpn);
      if (decoded?.family !== reference.family || found.has(mpn)) {
        continue;
      }
      found.set(mpn, { mpn, page: page.page });
    }
  }
  return [...found.values()];
}

/** The `linkMpn` half of `DatasheetRepository`. */
export interface DatasheetLinker {
  linkMpn(sha256: string, mpn: string): void;
}

/** The part of `PdfToolkit` family detection uses. */
export interface FamilyToolkit {
  findPages(ref: PdfRef, patterns?: Readonly<Record<string, RegExp>>): Promise<SectionMatches>;
  readPages(ref: PdfRef, pages: readonly number[]): Promise<readonly PageTextLike[]>;
}

export interface FamilyDeps {
  readonly toolkit: FamilyToolkit;
  readonly datasheets: DatasheetLinker;
}

export interface FamilyLinkResult {
  readonly sha256: string;
  readonly family: string;
  /** Ordering-information pages, as `findPages` reported them. */
  readonly pages: readonly number[];
  readonly mpns: readonly OrderingMpn[];
}

/**
 * Links every part number a datasheet's ordering table lists to the datasheet.
 *
 * One datasheet commonly covers a whole family, so "the datasheet for this
 * MPN" is usually a lie; recording the whole list is what makes the next
 * lookup of a sibling find the document already on disk. Only the
 * ordering-information pages are read, because a part number in the
 * applications section is an example rather than an orderable part.
 */
export async function linkDatasheetFamily(
  deps: FamilyDeps,
  ref: PdfRef,
  reference: DecodedMpn,
): Promise<FamilyLinkResult> {
  const sections = await deps.toolkit.findPages(ref, {
    orderingInformation: SECTION_PATTERNS.orderingInformation,
  });
  const pages = (sections.orderingInformation ?? []).map((match) => match.page);
  if (pages.length === 0) {
    return { sha256: ref.sha256, family: reference.family, pages, mpns: [] };
  }
  const texts = await deps.toolkit.readPages(ref, pages);
  const mpns = orderingMpnsFrom(texts, reference);
  for (const { mpn } of mpns) {
    deps.datasheets.linkMpn(ref.sha256, mpn);
  }
  return { sha256: ref.sha256, family: reference.family, pages, mpns };
}
