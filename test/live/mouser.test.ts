/**
 * Live contract test for the Mouser adapter.
 *
 * Runs only under `npm run test:live`, never in CI, and spends real quota.
 * It checks that the recorded fixtures still describe what the API returns.
 */
import { describe, expect, it } from 'vitest';

import { MouserApi, MouserClient } from '../../src/adapters/mouser/index.js';
import { Cache, FileCacheStore } from '../../src/cache/index.js';
import { loadConfig } from '../../src/config.js';
import path from 'node:path';

const enabled = process.env.LIVE_TESTS === '1';

describe.skipIf(!enabled)('Mouser live contract', () => {
  process.loadEnvFile('.env');
  const config = loadConfig();

  const api = new MouserApi({
    client: new MouserClient({ apiKey: config.mouser.apiKey }),
    cache: new Cache({ store: new FileCacheStore(path.join(config.dataDir, 'cache')) }),
    fallbackCurrency: config.digikey.locale.currency as never,
    // A contract test that reads a cached copy tests nothing.
    force: true,
  });

  it('has a Search API key configured', () => {
    expect(config.mouser.apiKey, 'set MOUSER_API_KEY in .env').toBeDefined();
  });

  it('still returns a usable listing for a known part', async () => {
    const lookup = await api.lookup('TPS54331DR');

    expect(lookup.offer.sku).toMatch(/^595-/);
    expect(lookup.offer.priceBreaks.length).toBeGreaterThan(0);
    expect(lookup.offer.priceBreaks[0]?.unitPrice).toBeGreaterThan(0);
    expect(lookup.siblings.length).toBeGreaterThan(0);
  });

  it('still returns only packaging attributes, not parametrics', async () => {
    // If this fails, Mouser has started publishing parametric data and the
    // mapping table in src/adapters/mouser/map.ts should be revisited.
    const lookup = await api.lookup('TPS54331DR');

    expect(lookup.unmapped).toEqual(['Packaging', 'Standard Pack Qty']);
  });

  it('reports a part Mouser does not list', async () => {
    await expect(api.lookup('XL4015E1')).rejects.toMatchObject({ code: 'MOUSER_NOT_FOUND' });
  });
});
