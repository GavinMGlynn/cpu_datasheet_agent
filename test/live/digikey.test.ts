/**
 * Live contract test for the Digi-Key adapter.
 *
 * Runs only under `npm run test:live`, never in CI, and spends real quota. It
 * exists to catch schema drift: the recorded fixtures are what the unit tests
 * believe the API returns, and this checks that belief against the API itself.
 */
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { DigiKeyApi, DigiKeyClient, FileTokenStore } from '../../src/adapters/digikey/index.js';
import { Cache, FileCacheStore } from '../../src/cache/index.js';
import { loadConfig } from '../../src/config.js';
import { loadFixture } from '../helpers/digikey-fixtures.js';

const enabled = process.env.LIVE_TESTS === '1';

/** Two parts is enough to detect drift; each one costs quota. */
const PARTS = ['TPS54331DR', 'AP63203WU-7'] as const;

function keysOf(value: unknown): string[] {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.keys(value).sort()
    : [];
}

describe.skipIf(!enabled)('Digi-Key live contract', () => {
  process.loadEnvFile('.env');
  const config = loadConfig();

  const api = new DigiKeyApi({
    client: new DigiKeyClient({
      clientId: config.digikey.clientId,
      clientSecret: config.digikey.clientSecret,
      sandbox: config.digikey.sandbox,
      locale: config.digikey.locale,
      tokenStore: new FileTokenStore(path.join(config.dataDir, 'tokens', 'digikey.json')),
    }),
    cache: new Cache({ store: new FileCacheStore(path.join(config.dataDir, 'cache')) }),
    locale: config.digikey.locale,
    sandbox: config.digikey.sandbox,
    // Bypass the cache: a contract test that reads a cached copy tests nothing.
    force: true,
  });

  it('has credentials configured', () => {
    expect(config.digikey.clientId, 'set DIGIKEY_CLIENT_ID in .env').toBeDefined();
    expect(config.digikey.clientSecret, 'set DIGIKEY_CLIENT_SECRET in .env').toBeDefined();
  });

  it.each(PARTS)('still returns the recorded shape for %s', async (mpn) => {
    const live = await api.productDetails(mpn);
    const recorded = loadFixture(`${mpn}.productdetails.json`) as { Product: unknown };

    expect(keysOf(live.value)).toEqual(expect.arrayContaining(keysOf(recorded)));
    expect(keysOf(live.value.Product)).toEqual(expect.arrayContaining(keysOf(recorded.Product)));
  });

  it('still yields usable offers and parametrics for a known part', async () => {
    const lookup = await api.lookup('TPS54331DR');

    expect(lookup.offers.length).toBeGreaterThan(0);
    expect(lookup.datasheetUrl).toBeDefined();
    expect(lookup.failures, 'a parametric value stopped parsing').toEqual([]);
    expect(lookup.facts.map((fact) => fact.key)).toEqual(
      expect.arrayContaining(['vinMin', 'vinMax', 'ioutMax']),
    );
  });

  it('reports a part Digi-Key does not list', async () => {
    await expect(api.productDetails('XL4015E1')).rejects.toMatchObject({
      code: 'DIGIKEY_NOT_FOUND',
    });
  });
});
