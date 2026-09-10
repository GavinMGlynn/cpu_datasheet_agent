import { readFileSync } from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(import.meta.dirname, '..', 'fixtures', 'digikey');

/**
 * Loads a recorded Digi-Key response. Fixtures are live responses with
 * account-identifying fields removed; see `scripts/record-fixture.ts`.
 */
export function loadFixture(name: string): unknown {
  const parsed: unknown = JSON.parse(readFileSync(path.join(DIR, name), 'utf8'));
  return parsed;
}

/** Every recorded part number, by fixture slug. */
export const RECORDED = {
  tps54331: 'TPS54331DR',
  mp1584: 'MP1584EN-LF-Z',
  ap63203: 'AP63203WU-7',
  notListed: 'XL4015E1',
} as const;

export function productDetails(slug: string): unknown {
  return loadFixture(`${slug}.productdetails.json`);
}
