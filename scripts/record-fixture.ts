/**
 * Records sanitised distributor responses as test fixtures.
 *
 *   npx tsx scripts/record-fixture.ts digikey TPS54331DR MP1584EN-LF-Z
 *   npx tsx scripts/record-fixture.ts digikey --ops productdetails LM5164DDAR
 *   npx tsx scripts/record-fixture.ts digikey --keyword TPS54331
 *   npx tsx scripts/record-fixture.ts mouser TPS54331DR AP63203WU-7
 *
 * Spends live API quota. Credentials come from .env; nothing is written that
 * identifies the account.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { DigiKeyApi, DigiKeyClient, FileTokenStore } from '../src/adapters/digikey/index.js';
import { fixtureName, sanitiseFixture } from '../src/adapters/digikey/fixtures.js';
import { MouserApi, MouserClient } from '../src/adapters/mouser/index.js';
import { Cache, FileCacheStore } from '../src/cache/index.js';
import { loadConfig } from '../src/config.js';
import { isChipAgentError } from '../src/errors.js';

const DIGIKEY_OPS = [
  'productdetails',
  'pricing',
  'media',
  'substitutions',
  'alternatepackaging',
] as const;
type DigiKeyOp = (typeof DIGIKEY_OPS)[number];

process.loadEnvFile('.env');
const config = loadConfig();

const args = process.argv.slice(2);
const distributor = args.shift();
if (distributor !== 'digikey' && distributor !== 'mouser') {
  console.error('usage: record-fixture <digikey|mouser> [--ops a,b] [--keyword text] <mpn>...');
  process.exit(2);
}

let ops: readonly DigiKeyOp[] = DIGIKEY_OPS;
let keyword: string | undefined;
const mpns: string[] = [];
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--ops') {
    i += 1;
    ops = (args[i] ?? '')
      .split(',')
      .filter((name): name is DigiKeyOp => (DIGIKEY_OPS as readonly string[]).includes(name));
  } else if (arg === '--keyword') {
    i += 1;
    keyword = args[i];
  } else if (arg !== undefined) {
    mpns.push(arg);
  }
}

const outDir = path.resolve('test/fixtures', distributor);
await mkdir(outDir, { recursive: true });
const store = new FileCacheStore(path.join(config.dataDir, 'cache'));
const cache = new Cache({ store });

async function save(name: string, value: unknown): Promise<void> {
  const file = path.join(outDir, name);
  await writeFile(file, `${JSON.stringify(sanitiseFixture(value), null, 2)}\n`, 'utf8');
  console.error(`wrote ${path.relative(process.cwd(), file)}`);
}

if (distributor === 'digikey') {
  const api = new DigiKeyApi({
    client: new DigiKeyClient({
      clientId: config.digikey.clientId,
      clientSecret: config.digikey.clientSecret,
      sandbox: config.digikey.sandbox,
      locale: config.digikey.locale,
      tokenStore: new FileTokenStore(path.join(config.dataDir, 'tokens', 'digikey.json')),
    }),
    cache,
    locale: config.digikey.locale,
    sandbox: config.digikey.sandbox,
  });

  if (keyword !== undefined) {
    await save(fixtureName(keyword, 'keyword'), (await api.searchKeyword(keyword)).value);
  }
  for (const mpn of mpns) {
    for (const op of ops) {
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
          // A part the distributor does not list is a case the adapter must
          // handle, so the absence is recorded as deliberately as a response.
          await save(fixtureName(mpn, `${op}.notfound`), {
            error: error.code,
            message: error.message,
          });
          continue;
        }
        throw error;
      }
    }
  }
} else {
  const api = new MouserApi({
    client: new MouserClient({ apiKey: config.mouser.apiKey }),
    cache,
    fallbackCurrency: config.digikey.locale.currency as never,
  });

  if (keyword !== undefined) {
    await save(fixtureName(keyword, 'keyword'), (await api.searchKeyword(keyword)).value);
  }
  for (const mpn of mpns) {
    await save(fixtureName(mpn, 'partnumber'), (await api.searchPartNumber(mpn)).value);
  }
}
