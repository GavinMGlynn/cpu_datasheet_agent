/**
 * Records sanitised Digi-Key responses as test fixtures.
 *
 *   npx tsx scripts/record-fixture.ts TPS54331DR MP1584EN-LF-Z
 *   npx tsx scripts/record-fixture.ts --ops productdetails LM5164DDAR
 *   npx tsx scripts/record-fixture.ts --keyword TPS54331
 *
 * Spends live API quota. Credentials come from .env; nothing is written that
 * identifies the account.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { DigiKeyApi, DigiKeyClient, FileTokenStore } from '../src/adapters/digikey/index.js';
import { fixtureName, sanitiseFixture } from '../src/adapters/digikey/fixtures.js';
import { Cache, FileCacheStore } from '../src/cache/index.js';
import { loadConfig } from '../src/config.js';
import { isChipAgentError } from '../src/errors.js';

const ALL_OPS = [
  'productdetails',
  'pricing',
  'media',
  'substitutions',
  'alternatepackaging',
] as const;
type Op = (typeof ALL_OPS)[number];

const OUT_DIR = path.resolve('test/fixtures/digikey');

process.loadEnvFile('.env');
const config = loadConfig();

const args = process.argv.slice(2);
let ops: readonly Op[] = ALL_OPS;
let keyword: string | undefined;
const mpns: string[] = [];

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--ops') {
    i += 1;
    ops = (args[i] ?? '')
      .split(',')
      .filter((name): name is Op => (ALL_OPS as readonly string[]).includes(name));
  } else if (arg === '--keyword') {
    i += 1;
    keyword = args[i];
  } else if (arg !== undefined) {
    mpns.push(arg);
  }
}

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

await mkdir(OUT_DIR, { recursive: true });

async function save(name: string, value: unknown): Promise<void> {
  const file = path.join(OUT_DIR, name);
  await writeFile(file, `${JSON.stringify(sanitiseFixture(value), null, 2)}\n`, 'utf8');
  console.error(`wrote ${path.relative(process.cwd(), file)}`);
}

async function record(mpn: string, op: Op): Promise<void> {
  try {
    const result = await {
      productdetails: () => api.productDetails(mpn),
      pricing: () => api.pricing(mpn),
      media: () => api.media(mpn),
      substitutions: () => api.substitutions(mpn),
      alternatepackaging: () => api.alternatePackaging(mpn),
    }[op]();
    await save(fixtureName(mpn, op), result.value);
  } catch (error) {
    if (isChipAgentError(error) && error.code === 'DIGIKEY_NOT_FOUND') {
      // A part Digi-Key does not list is a case the adapter must handle, so
      // the absence is recorded as deliberately as a response would be.
      await save(fixtureName(mpn, `${op}.notfound`), { error: error.code, message: error.message });
      return;
    }
    throw error;
  }
}

if (keyword !== undefined) {
  const result = await api.searchKeyword(keyword);
  await save(fixtureName(keyword, 'keyword'), result.value);
}

for (const mpn of mpns) {
  for (const op of ops) {
    await record(mpn, op);
  }
}
