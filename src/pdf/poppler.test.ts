import { describe, expect, it, vi } from 'vitest';

import { POPPLER_BINARIES, PopplerMissingError, popplerPreflight } from './poppler.js';
import { SubprocessError, type RunFn } from './subprocess.js';

const ok = (text: string): Awaited<ReturnType<RunFn>> => ({
  stdout: Buffer.alloc(0),
  stderr: text,
  code: 0,
});

describe('popplerPreflight against the real installation', () => {
  it('finds every binary and records its version', async () => {
    const tools = await popplerPreflight();

    expect(Object.keys(tools.binaries).sort()).toEqual([...POPPLER_BINARIES].sort());
    for (const binary of POPPLER_BINARIES) {
      expect(tools.binaries[binary]).toBe(binary);
      expect(tools.versions[binary]).toMatch(/^\d+\.\d+/);
    }
  });
});

describe('popplerPreflight with an injected runner', () => {
  it('parses the version from stderr or stdout', async () => {
    const runner = vi.fn((bin: string) =>
      Promise.resolve(
        bin === 'pdfinfo'
          ? { stdout: Buffer.from('pdfinfo version 24.02.0\n'), stderr: '', code: 0 }
          : ok(`${bin} version 23.08.0\n`),
      ),
    ) as unknown as RunFn;

    const tools = await popplerPreflight({ run: runner });

    expect(tools.versions).toEqual({
      pdftotext: '23.08.0',
      pdftoppm: '23.08.0',
      pdfinfo: '24.02.0',
    });
  });

  it('records an unrecognised version banner as unknown', async () => {
    const runner = (() => Promise.resolve(ok('something else entirely'))) as unknown as RunFn;

    const tools = await popplerPreflight({ run: runner });

    expect(tools.versions.pdftotext).toBe('unknown');
  });

  it('honours overridden binary paths and the timeout', async () => {
    const runner = vi.fn(() => Promise.resolve(ok('pdftotext version 1.0'))) as unknown as RunFn;

    const tools = await popplerPreflight({
      binaries: { pdftotext: '/opt/poppler/bin/pdftotext' },
      run: runner,
      timeoutMs: 1234,
    });

    expect(tools.binaries.pdftotext).toBe('/opt/poppler/bin/pdftotext');
    expect(tools.binaries.pdfinfo).toBe('pdfinfo');
    expect(vi.mocked(runner)).toHaveBeenCalledWith('/opt/poppler/bin/pdftotext', ['-v'], {
      timeoutMs: 1234,
    });
  });

  it('omits the timeout when none is given', async () => {
    const runner = vi.fn(() => Promise.resolve(ok('pdftotext version 1.0'))) as unknown as RunFn;

    await popplerPreflight({ run: runner });

    expect(vi.mocked(runner)).toHaveBeenCalledWith('pdftotext', ['-v'], {});
  });

  it('names every binary it could not run, with an install hint', async () => {
    const runner = ((bin: string) =>
      bin === 'pdftoppm'
        ? Promise.reject(new SubprocessError('SUBPROCESS_SPAWN_FAILED', 'cannot start pdftoppm'))
        : Promise.resolve(ok(`${bin} version 24.02.0`))) as unknown as RunFn;

    await expect(popplerPreflight({ run: runner })).rejects.toBeInstanceOf(PopplerMissingError);
    try {
      await popplerPreflight({ run: runner });
    } catch (error) {
      const failure = error as PopplerMissingError;
      expect(failure.code).toBe('POPPLER_MISSING');
      expect(failure.message).toContain('pdftoppm');
      expect(failure.message).toContain('poppler-utils');
      expect(failure.details).toEqual({
        missing: [{ binary: 'pdftoppm', reason: 'cannot start pdftoppm' }],
      });
    }
  });

  it('reports a non-error rejection as text', async () => {
    // A rejection carrying something that is not an Error. The reason is typed
    // as one so the promise lint rules accept it; at runtime it is a string,
    // which is the case this test covers.
    const reason = 'exploded' as unknown as Error;
    const runner = (() => Promise.reject(reason)) as unknown as RunFn;

    try {
      await popplerPreflight({ run: runner });
    } catch (error) {
      expect((error as PopplerMissingError).details).toMatchObject({
        missing: [
          { binary: 'pdftotext', reason: 'exploded' },
          { binary: 'pdftoppm', reason: 'exploded' },
          { binary: 'pdfinfo', reason: 'exploded' },
        ],
      });
    }
  });
});
