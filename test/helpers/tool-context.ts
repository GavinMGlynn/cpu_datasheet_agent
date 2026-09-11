import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Cache, FileCacheStore } from '../../src/cache/index.js';
import { createRepositories, openDatabase, type Db } from '../../src/db/index.js';
import { ToolCallLedger, readLedger } from '../../src/log/index.js';
import type { ToolCallRecord } from '../../src/core/index.js';
import { PdfToolkit, popplerPreflight, type PdfRef } from '../../src/pdf/index.js';
import { DEFAULT_QUOTA_POLICY, type QuotaPolicy, type ToolContext } from '../../src/tools/index.js';
import type { DigiKeyApi } from '../../src/adapters/digikey/index.js';
import type { MouserApi } from '../../src/adapters/mouser/index.js';
import { buildPdf, datasheetSpec } from './pdf-fixtures.js';

export const TEST_NOW = '2026-09-11T00:00:00.000Z';

export interface TestHarness {
  readonly context: ToolContext;
  readonly root: string;
  readonly db: Db;
  readonly cache: Cache;
  /** Ids handed out by `newId`, in order, so a test can name what was created. */
  readonly ids: string[];
  /** Writes a datasheet PDF into the temp directory and records it. */
  addDatasheet(): Promise<PdfRef>;
  ledgerRecords(): Promise<readonly ToolCallRecord[]>;
  close(): Promise<void>;
}

export interface HarnessOptions {
  /** Built from the harness's own cache, so a tool and a test share one store. */
  readonly digikey?: (cache: Cache) => DigiKeyApi;
  readonly mouser?: (cache: Cache) => MouserApi;
  readonly policy?: QuotaPolicy;
  readonly headless?: boolean;
}

/**
 * A tool context over a temporary directory and an in-memory database.
 *
 * Poppler runs for real, as it does everywhere else in this project: the PDFs
 * are generated at test time, so there is nothing to record and nothing
 * copyrighted to commit.
 */
export async function createHarness(options: HarnessOptions = {}): Promise<TestHarness> {
  const root = await mkdtemp(path.join(tmpdir(), 'tools-'));
  const store = new FileCacheStore(path.join(root, 'cache'));
  const cache = new Cache({ store });
  const db = openDatabase(':memory:');
  const ledger = new ToolCallLedger({ dir: path.join(root, 'ledger'), sessionId: 'test-session' });
  const toolkit = new PdfToolkit({ cache, store, tools: await popplerPreflight() });
  const ids: string[] = [];
  let counter = 0;

  const context: ToolContext = {
    repositories: createRepositories(db),
    cache,
    toolkit,
    ...(options.digikey === undefined ? {} : { digikey: options.digikey(cache) }),
    ...(options.mouser === undefined ? {} : { mouser: options.mouser(cache) }),
    ledger,
    policy: options.policy ?? DEFAULT_QUOTA_POLICY,
    headless: options.headless ?? true,
    now: () => TEST_NOW,
    newId: () => {
      counter += 1;
      const id = `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
      ids.push(id);
      return id;
    },
  };

  return {
    context,
    root,
    db,
    cache,
    ids,
    async addDatasheet(): Promise<PdfRef> {
      const bytes = await buildPdf(datasheetSpec());
      const localPath = path.join(root, 'datasheet.pdf');
      await writeFile(localPath, bytes);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      context.repositories.datasheets.record({
        url: 'https://example.test/datasheet.pdf',
        sha256,
        pageCount: 4,
        fetchedAt: TEST_NOW,
        localPath,
        coversMpns: [],
      });
      return { localPath, sha256 };
    },
    async ledgerRecords(): Promise<readonly ToolCallRecord[]> {
      await ledger.flush();
      const records: ToolCallRecord[] = [];
      for await (const record of readLedger(path.join(root, 'ledger'), {}, (malformed) => {
        throw new Error(`malformed ledger line: ${JSON.stringify(malformed)}`);
      })) {
        records.push(record);
      }
      return records;
    },
    async close(): Promise<void> {
      await ledger.flush();
      db.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
