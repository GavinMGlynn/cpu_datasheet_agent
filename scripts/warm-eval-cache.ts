/**
 * Warms the cache for an evaluation run.
 *
 *   npx tsx scripts/warm-eval-cache.ts
 *   npx tsx scripts/warm-eval-cache.ts TPS54331DR LM5164DDAR
 *
 * An evaluation runs with no budget: every distributor answer and every
 * datasheet has to be on disk already, or the part is reported as starved
 * rather than scored. This asks the distributors once, through the same tools
 * the agent uses, so the cache keys are the ones the agent will look under —
 * and fetches both the datasheet the distributor points at and the one the
 * golden file was read from.
 *
 * Distributor calls are free of money and cost only API quota, which is what
 * makes this the operator's job rather than the agent's (D40).
 */
import { loadConfig, loadEnvFileIfPresent } from '../src/config.js';
import { loadGoldenSet } from '../src/eval/index.js';
import { buildRegistry, createToolContext, DEFAULT_QUOTA_POLICY } from '../src/tools/index.js';

loadEnvFileIfPresent();
const config = loadConfig();
const wanted = process.argv.slice(2);
const golden = loadGoldenSet().filter(
  ({ part }) => wanted.length === 0 || wanted.includes(part.mpn),
);

const { context, db } = await createToolContext({ config, policy: DEFAULT_QUOTA_POLICY });
const registry = buildRegistry();

interface OffersResult {
  status: string;
  datasheetUrl?: string;
  offers?: unknown[];
}

async function warm(mpn: string, goldenUrl: string): Promise<string> {
  const notes: string[] = [];
  try {
    await registry.call('resolve_mpn', { mpn, confirmSpend: true }, context);
    notes.push('resolved');
  } catch (error) {
    notes.push(`resolve failed: ${String(error)}`);
  }
  let distributorUrl: string | undefined;
  try {
    const offers = (await registry.call(
      'fetch_offers',
      { mpn, confirmSpend: true },
      context,
    )) as OffersResult;
    distributorUrl = offers.datasheetUrl;
    notes.push(`offers ${String(offers.offers?.length ?? 0)}`);
  } catch (error) {
    notes.push(`offers failed: ${String(error)}`);
  }
  for (const url of new Set([goldenUrl, distributorUrl].filter((one) => one !== undefined))) {
    try {
      const fetched = (await registry.call('fetch_datasheet', { url, mpn }, context)) as {
        hit: boolean;
      };
      notes.push(fetched.hit ? 'pdf cached' : 'pdf fetched');
    } catch (error) {
      notes.push(`pdf failed (${url}): ${String(error)}`);
    }
  }
  return notes.join(', ');
}

try {
  for (const { part } of golden) {
    console.log(`${part.mpn}: ${await warm(part.mpn, part.datasheet.url)}`);
  }
} finally {
  db.close();
}
