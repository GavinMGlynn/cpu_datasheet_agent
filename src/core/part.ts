import { z } from 'zod';

import { BuckRegulatorParameters } from './buck-regulator.js';
import { Classification } from './classification.js';
import { Datasheet } from './datasheet.js';
import { Offer } from './offer.js';
import { PARAMETER_KEYS } from './parameter-keys.js';
import { Iso8601, ManufacturerName, NormalisedMpn } from './primitives.js';
import { Verification } from './verification.js';

export const CATEGORIES = ['buck_regulator'] as const;
export const Category = z.enum(CATEGORIES);
export type Category = z.output<typeof Category>;

export const PART_STATUSES = ['extracted', 'needs_human', 'verified', 'rejected'] as const;
export const PartStatus = z.enum(PART_STATUSES);
export type PartStatus = z.output<typeof PartStatus>;

/**
 * The aggregate stored by `upsert_part`. Invariants enforced here:
 * - a parameter citing a datasheet must cite this part's datasheet, on a page it has;
 * - `verified` status requires every parameter to be verified;
 * - a parameter carrying a distributor conflict has confidence `conflict`;
 * - a parameter in conflict forces `needs_human` or `rejected`;
 * - one classification per axis, one offer per distributor SKU;
 * - `updatedAt` is not before `createdAt`.
 */
export const Part = z
  .strictObject({
    mpn: NormalisedMpn,
    manufacturer: ManufacturerName,
    category: Category,
    parameters: BuckRegulatorParameters,
    datasheet: Datasheet.optional(),
    offers: z.array(Offer),
    classifications: z.array(Classification),
    verifications: z.array(Verification),
    status: PartStatus,
    createdAt: Iso8601,
    updatedAt: Iso8601,
  })
  .superRefine((part, ctx) => {
    const issue = (path: PropertyKey[], message: string): void => {
      ctx.addIssue({ code: 'custom', message, path });
    };

    for (const key of PARAMETER_KEYS) {
      const { provenance, conflicts, confidence } = part.parameters[key];
      if (conflicts !== undefined && confidence !== 'conflict') {
        issue(
          ['parameters', key, 'confidence'],
          'a parameter carrying a distributor conflict must have confidence "conflict"',
        );
      }
      if (provenance.source !== 'datasheet') {
        continue;
      }
      const path = ['parameters', key, 'provenance'];
      if (part.datasheet === undefined) {
        issue(path, 'cites a datasheet but the part has none');
      } else if (provenance.sha256 !== part.datasheet.sha256) {
        issue([...path, 'sha256'], 'cites a different datasheet from the one attached to the part');
      } else if (provenance.page > part.datasheet.pageCount) {
        issue(
          [...path, 'page'],
          `page exceeds the datasheet's ${String(part.datasheet.pageCount)} pages`,
        );
      }
    }

    const confidences = PARAMETER_KEYS.map((key) => part.parameters[key].confidence);
    if (part.status === 'verified' && confidences.some((confidence) => confidence !== 'verified')) {
      issue(['status'], 'a verified part must have every parameter verified');
    }
    if (
      confidences.includes('conflict') &&
      part.status !== 'needs_human' &&
      part.status !== 'rejected'
    ) {
      issue(['status'], 'a part with a parameter in conflict must be needs_human or rejected');
    }

    const axes = new Set<string>();
    part.classifications.forEach((classification, index) => {
      if (axes.has(classification.axis)) {
        issue(
          ['classifications', index, 'axis'],
          `duplicate classification axis ${classification.axis}`,
        );
      }
      axes.add(classification.axis);
    });

    const skus = new Set<string>();
    part.offers.forEach((offer, index) => {
      const key = `${offer.distributor}:${offer.sku}`;
      if (skus.has(key)) {
        issue(['offers', index, 'sku'], `duplicate offer ${key}`);
      }
      skus.add(key);
    });

    if (Date.parse(part.updatedAt) < Date.parse(part.createdAt)) {
      issue(['updatedAt'], 'updatedAt cannot be earlier than createdAt');
    }
  });
export type Part = z.output<typeof Part>;
