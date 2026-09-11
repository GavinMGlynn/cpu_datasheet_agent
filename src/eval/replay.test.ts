import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ToolCallLedger, ledgerFileName, type MalformedLine } from '../log/index.js';
import { ReplayError, renderReplay, replayRun } from './replay.js';

const RUN_CALL = '3f5a1c2e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';
const RUN_ID = '9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b';

let dir: string;
let ledger: ToolCallLedger;
let malformed: MalformedLine[];

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'replay-'));
  malformed = [];
  ledger = new ToolCallLedger({
    dir,
    sessionId: 'replay-session',
    idGenerator: (() => {
      let issued = 0;
      return (): string => {
        issued += 1;
        return issued === 1
          ? RUN_CALL
          : `00000000-0000-4000-9000-${String(issued).padStart(12, '0')}`;
      };
    })(),
  });
});

afterEach(async () => {
  await ledger.flush();
  await rm(dir, { recursive: true, force: true });
});

function note(one: MalformedLine): void {
  malformed.push(one);
}

/** A run and the calls it made, as `executeRun` records them. */
async function writeRun(): Promise<void> {
  const parent = ledger.begin('extract_part', { mpn: 'TPS54331DR' }, { spendsQuota: false });
  const read = ledger.begin(
    'read_pages',
    { pages: [4] },
    { spendsQuota: false, parentId: RUN_CALL },
  );
  await ledger.end(read, { output: { pages: [{ page: 4, text: 'Input voltage 3.5 V to 28 V' }] } });
  const failed = ledger.begin(
    'pdf_info',
    { sha256: 'f'.repeat(64) },
    { spendsQuota: false, parentId: RUN_CALL },
  );
  await ledger.end(failed, { error: new Error('no such datasheet') });
  await ledger.end(parent, { output: { run: { id: RUN_ID, result: 'extracted' } } });
}

describe('replayRun', () => {
  it('finds a run by the id in its record, and lists what it called', async () => {
    await writeRun();

    const replay = await replayRun(dir, RUN_ID, note);

    expect(replay.run.tool).toBe('extract_part');
    expect(replay.calls.map((call) => call.tool)).toEqual(['read_pages', 'pdf_info']);
    expect(replay.calls[0]?.output).toMatchObject({ pages: [{ page: 4 }] });
    expect(replay.calls[1]?.error).toMatchObject({ message: 'no such datasheet' });
    expect(malformed).toEqual([]);
  });

  it('finds the same run by its ledger entry', async () => {
    await writeRun();

    expect((await replayRun(dir, RUN_CALL, note)).calls).toHaveLength(2);
  });

  it('reads back an output too big to keep in the day file', async () => {
    const big = new ToolCallLedger({ dir, sessionId: 's', sidecarThresholdBytes: 32 });
    const parent = big.begin('extract_part', {}, { spendsQuota: false });
    await big.end(parent, { output: { run: { id: RUN_ID } } });
    const child = big.begin('read_pages', {}, { spendsQuota: false, parentId: parent });
    await big.end(child, { output: { text: 'x'.repeat(200) } });
    await big.flush();

    const replay = await replayRun(dir, RUN_ID, note);

    expect(replay.calls[0]?.output).toEqual({ text: 'x'.repeat(200) });
  });

  it('refuses an id no run has', async () => {
    await writeRun();

    await expect(replayRun(dir, 'nobody', note)).rejects.toThrow(ReplayError);
  });

  it('reports a line it cannot read rather than stopping', async () => {
    await writeRun();
    await ledger.flush();
    await writeFile(path.join(dir, ledgerFileName(new Date())), 'not a record\n', { flag: 'a' });

    expect((await replayRun(dir, RUN_ID, note)).calls).toHaveLength(2);
    expect(malformed).toHaveLength(1);
  });
});

describe('renderReplay', () => {
  it('reads as one line per call, in order, with long values clipped', async () => {
    await writeRun();

    const rendered = renderReplay(await replayRun(dir, RUN_ID, note), 20);

    expect(rendered).toContain('extract_part');
    expect(rendered).toContain('read_pages');
    expect(rendered).toContain('  err  ');
    expect(rendered).toContain('…');
  });
});
