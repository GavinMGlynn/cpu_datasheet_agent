import { z } from 'zod';

import { Iso8601, NormalisedMpn, Sha256, Url } from './primitives.js';

/** A fetched datasheet PDF and the part numbers its ordering table covers. */
export const Datasheet = z
  .strictObject({
    url: Url,
    sha256: Sha256,
    pageCount: z.number().int().min(1),
    fetchedAt: Iso8601,
    localPath: z.string().trim().min(1),
    /** Empty until the MPN module reads the ordering table. */
    coversMpns: z.array(NormalisedMpn),
  })
  .superRefine((datasheet, ctx) => {
    const seen = new Set<string>();
    datasheet.coversMpns.forEach((mpn, index) => {
      if (seen.has(mpn)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate MPN ${mpn}`,
          path: ['coversMpns', index],
        });
      }
      seen.add(mpn);
    });
  });
export type Datasheet = z.output<typeof Datasheet>;
