/**
 * Records a corpus of real part numbers for the MPN decoders to be tested
 * against.
 *
 *   npx tsx scripts/record-mpn-corpus.ts && npm run format
 *
 * Each entry carries the part number alongside Digi-Key's own package,
 * packaging and temperature fields, so a decoder can be checked against an
 * independent source rather than against someone's reading of an ordering
 * guide. Spends live API quota: one keyword search per family.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { DigiKeyApi, DigiKeyClient, FileTokenStore } from '../src/adapters/digikey/index.js';
import { Cache, FileCacheStore } from '../src/cache/index.js';
import { loadConfig } from '../src/config.js';

/** Family prefixes chosen to return many part numbers from one manufacturer. */
const FAMILIES: readonly { readonly manufacturer: string; readonly keywords: readonly string[] }[] =
  [
    { manufacturer: 'texas-instruments', keywords: ['TPS54', 'LMR33', 'TPS62'] },
    { manufacturer: 'monolithic-power-systems', keywords: ['MP2315', 'MP1584', 'MPQ4'] },
    { manufacturer: 'diodes-incorporated', keywords: ['AP63', 'AP62'] },
    { manufacturer: 'analog-devices', keywords: ['LT8610', 'LTC3630', 'MAX17503'] },
    {
      manufacturer: 'richtek',
      keywords: [
        'RT8279',
        'RT6190',
        'RT8272',
        'RT7297',
        'RT6206',
        'RT8299',
        'RT8296',
        'RT6202',
        'RT8259',
        'RT8010',
        'RT6208',
        'RT8290',
        'RT7278',
        'RT8256',
        'RT8237',
      ],
    },
    {
      manufacturer: 'onsemi',
      keywords: ['NCP3170', 'NCV890', 'NCP1595', 'NCP3335', 'NCP6335', 'NCV891930'],
    },
    {
      manufacturer: 'microchip',
      keywords: [
        'MCP16331',
        'MIC2103',
        'MCP16311',
        'MCP16301',
        'MIC23',
        'MIC2101',
        'MCP1603',
        'MIC28',
      ],
    },
    {
      manufacturer: 'stmicroelectronics',
      keywords: ['ST1S10', 'L7987', 'L6986', 'L7986', 'ST1S14', 'L5987', 'ST1PS01'],
    },
  ];

process.loadEnvFile('.env');
const config = loadConfig();
const outDir = path.resolve('test/fixtures/mpn');
await mkdir(outDir, { recursive: true });

const store = new FileCacheStore(path.join(config.dataDir, 'cache'));
const api = new DigiKeyApi({
  client: new DigiKeyClient({
    clientId: config.digikey.clientId,
    clientSecret: config.digikey.clientSecret,
    sandbox: config.digikey.sandbox,
    locale: config.digikey.locale,
    tokenStore: new FileTokenStore(path.join(config.dataDir, 'tokens', 'digikey.json')),
  }),
  cache: new Cache({ store }),
  locale: config.digikey.locale,
  sandbox: config.digikey.sandbox,
});

function parameter(
  product: { Parameters: { ParameterText: string; ValueText: string }[] },
  name: string,
): string {
  return product.Parameters.find((entry) => entry.ParameterText === name)?.ValueText ?? '';
}

for (const family of FAMILIES) {
  const entries: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const keyword of family.keywords) {
    const { value } = await api.searchKeyword(keyword, 50);
    for (const product of value.Products) {
      const mpn = product.ManufacturerProductNumber;
      if (seen.has(mpn)) {
        continue;
      }
      seen.add(mpn);
      entries.push({
        mpn,
        manufacturer: product.Manufacturer.Name,
        baseProductNumber: product.BaseProductNumber?.Name ?? null,
        packageCase: parameter(product, 'Package / Case'),
        supplierPackage: parameter(product, 'Supplier Device Package'),
        operatingTemperature: parameter(product, 'Operating Temperature'),
        packagings: product.ProductVariations.map(
          (variation) => variation.PackageType?.Name ?? '',
        ).filter((name) => name !== ''),
      });
    }
  }
  const file = path.join(outDir, `${family.manufacturer}.json`);
  await writeFile(file, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
  console.error(
    `wrote ${path.relative(process.cwd(), file)} (${String(entries.length)} part numbers)`,
  );
}
