import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buckParameters,
  classification,
  datasheet as datasheetFixture,
  distributorProvenance,
  escalation as escalationFixture,
  finishedRun,
  offer,
  param,
  part as partFixture,
  q,
  run as runFixture,
  toolCallRecord,
  withConfidence,
  type Loose,
} from '../helpers/core-fixtures.js';
import { createRepositories, openDatabase } from '../../src/db/index.js';
import { buildPdf, datasheetSpec } from '../helpers/pdf-fixtures.js';

/**
 * The data the browser tests run against.
 *
 * A temporary directory with a real store, a real ledger and a real PDF —
 * never the live one. An end-to-end test that can delete real data is a test
 * nobody dares run (D70).
 */

export const E2E_TOKEN = 'e2e-token-e2e-token-e2e';

export interface Seeded {
  readonly dataDir: string;
  readonly sha256: string;
}

function classifications(): Loose[] {
  return [
    classification({ axis: 'vinClass', value: 'le_42v' }),
    classification({ axis: 'ioutClass', value: 'le_3a', derivedFrom: ['ioutMax'] }),
    classification({ axis: 'topology', value: 'non_synchronous', derivedFrom: ['topology'] }),
    classification({ axis: 'integration', value: 'integrated_fet', derivedFrom: ['integration'] }),
    classification({ axis: 'outputType', value: 'adjustable', derivedFrom: ['voutFixed'] }),
    classification({ axis: 'packageFamily', value: 'soic', derivedFrom: ['package'] }),
    classification({
      axis: 'temperatureGrade',
      value: 'industrial',
      derivedFrom: ['operatingTempMin', 'operatingTempMax'],
    }),
    classification({ axis: 'features', value: ['enable'], derivedFrom: ['enablePin'] }),
  ];
}

/**
 * Points every datasheet-sourced parameter at the datasheet actually attached
 * to the part. The schema insists on it — a value that cites a different PDF
 * from the one the part holds is rejected, which is the rule doing its job.
 */
function citing(parameters: Loose, sha256: string, pageCount: number): Loose {
  const out: Loose = {};
  for (const [key, value] of Object.entries(parameters)) {
    const parameter = { ...(value as Loose) };
    const provenance = { ...(parameter.provenance as Loose) };
    if (provenance.source === 'datasheet') {
      const page = typeof provenance.page === 'number' ? provenance.page : 1;
      parameter.provenance = {
        ...provenance,
        sha256,
        // The fixture datasheet is four pages; a citation past the end is
        // rejected, and rightly.
        page: Math.min(page, pageCount),
      };
    }
    out[key] = parameter;
  }
  return out;
}

/** Builds the directory the browser tests read, replacing whatever was there. */
export async function seed(dataDir: string): Promise<Seeded> {
  await rm(dataDir, { recursive: true, force: true });
  await mkdir(path.join(dataDir, 'ledger'), { recursive: true });
  await mkdir(path.join(dataDir, 'eval-runs'), { recursive: true });

  const bytes = await buildPdf(datasheetSpec());
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const localPath = path.join(dataDir, 'pdfs', `${sha256}.pdf`);
  await mkdir(path.dirname(localPath), { recursive: true });
  await writeFile(localPath, bytes);

  const pages = datasheetSpec().pages.length;
  const db = openDatabase(path.join(dataDir, 'chip.sqlite'));
  const repositories = createRepositories(db);
  const sheet = datasheetFixture({
    sha256,
    url: 'https://example.invalid/xyz54331.pdf',
    pageCount: pages,
    localPath,
    coversMpns: ['TPS54331DR', 'AP62200WU-7'],
  });

  repositories.parts.upsertPart(
    partFixture({
      datasheet: sheet,
      classifications: classifications(),
      parameters: citing(buckParameters({ vinMax: param(q(28, 'V'), 4) }), sha256, pages),
    }),
  );
  repositories.parts.upsertPart(
    partFixture({
      mpn: 'AP62200WU-7',
      manufacturer: 'Diodes Incorporated',
      status: 'verified',
      datasheet: sheet,
      classifications: classifications(),
      parameters: withConfidence(
        citing(buckParameters({ vinMax: param(q(18, 'V'), 4) }), sha256, pages),
        'verified',
      ),
      offers: [
        offer({
          sku: '621-AP62200WU-7',
          priceBreaks: [{ quantity: 1, unitPrice: 0.92 }],
          provenance: distributorProvenance({ sku: '621-AP62200WU-7' }),
        }),
      ],
    }),
  );

  const start = (overrides: Loose): void => {
    repositories.runs.start(
      runFixture({
        ...overrides,
        endedAt: undefined,
        turns: undefined,
        costUsd: undefined,
        result: undefined,
        details: undefined,
      }),
    );
    const finished = finishedRun(overrides) as {
      id: string;
      endedAt: string;
      turns: number;
      costUsd: number;
      result: 'extracted';
      details: unknown;
      sessionId?: string;
    };
    repositories.runs.finish(finished.id, {
      endedAt: finished.endedAt,
      turns: finished.turns,
      costUsd: finished.costUsd,
      result: finished.result,
      details: finished.details,
      ...(finished.sessionId === undefined ? {} : { sessionId: finished.sessionId }),
    });
  };

  start({
    id: '00000000-0000-4000-8000-000000000001',
    mpn: 'TPS54331DR',
    kind: 'extract',
    costUsd: 3.41,
    turns: 18,
    sessionId: 'session-a',
    startedAt: '2026-09-11T09:00:00Z',
    endedAt: '2026-09-11T09:04:00Z',
  });
  start({
    id: '00000000-0000-4000-8000-000000000002',
    mpn: 'AP62200WU-7',
    kind: 'verify',
    promptVersion: 'verify.v1',
    costUsd: 0.45,
    turns: 6,
    result: 'verified',
    sessionId: 'session-b',
    startedAt: '2026-09-12T02:00:00Z',
    endedAt: '2026-09-12T02:01:00Z',
  });

  repositories.escalations.create(escalationFixture());
  db.close();

  const calls = [
    toolCallRecord({
      id: '00000000-0000-4000-8000-000000000010',
      sessionId: 'session-a',
      tool: 'resolve_mpn',
      startedAt: '2026-09-11T09:00:01Z',
      durationMs: 13,
    }),
    toolCallRecord({
      id: '00000000-0000-4000-8000-000000000011',
      sessionId: 'session-a',
      parentId: '00000000-0000-4000-8000-000000000010',
      tool: 'fetch_offers',
      spendsQuota: true,
      startedAt: '2026-09-11T09:00:05Z',
      durationMs: 2100,
    }),
    toolCallRecord({
      id: '00000000-0000-4000-8000-000000000012',
      sessionId: 'session-b',
      tool: 'read_pages',
      output: undefined,
      error: {
        name: 'CacheMissError',
        code: 'CACHE_MISS',
        message: 'no cached entry for pdf_page_text',
        details: { namespace: 'pdf_page_text' },
      },
      startedAt: '2026-09-12T02:00:10Z',
      durationMs: 4,
    }),
  ];
  await writeFile(
    path.join(dataDir, 'ledger', '2026-09-11.jsonl'),
    `${calls.map((call) => JSON.stringify(call)).join('\n')}\n`,
  );

  return { dataDir, sha256 };
}
