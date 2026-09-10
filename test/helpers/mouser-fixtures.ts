import { readFileSync } from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(import.meta.dirname, '..', 'fixtures', 'mouser');

/** Loads a recorded Mouser response, sanitised of account fields. */
export function loadMouserFixture(name: string): unknown {
  const parsed: unknown = JSON.parse(readFileSync(path.join(DIR, name), 'utf8'));
  return parsed;
}

export function partNumberFixture(slug: string): unknown {
  return loadMouserFixture(`${slug}.partnumber.json`);
}

/** Every recorded part, by fixture slug. */
export const RECORDED_SLUGS: readonly string[] = [
  'TPS54331DR',
  'MP1584EN-LF-Z',
  'AP63203WU-7',
  'TPS563200DDCR',
  'TPS62130RGTR',
  'TLV62569DBVR',
  'LMR33630ADDAR',
  'LM5164DDAR',
  'TPS54560BDDAR',
  'MP2315GJ-Z',
  'LT8610AEMSE-PBF',
  'NCP3170ADR2G',
  'ST1S10PHR',
];
