import { ChipAgentError } from '../errors.js';
import { group } from '../util/regex.js';
import { run, type RunFn } from './subprocess.js';

export class PopplerMissingError extends ChipAgentError {}

export const POPPLER_BINARIES = ['pdftotext', 'pdftoppm', 'pdfinfo'] as const;
export type PopplerBinary = (typeof POPPLER_BINARIES)[number];

export interface PopplerTools {
  /** Command name or absolute path for each binary. */
  readonly binaries: Readonly<Record<PopplerBinary, string>>;
  /** Version reported by each binary, for the environment record. */
  readonly versions: Readonly<Record<PopplerBinary, string>>;
}

export interface PreflightOptions {
  /** Overrides for binaries that are not on PATH. */
  readonly binaries?: Partial<Record<PopplerBinary, string>>;
  readonly run?: RunFn;
  readonly timeoutMs?: number;
}

const VERSION = /version\s+(\S+)/i;

const INSTALL_HINT =
  'install poppler (Rocky/Fedora: sudo dnf install poppler-utils, Debian/Ubuntu: sudo apt-get install poppler-utils)';

/**
 * Checks that every poppler binary is present and records its version.
 * Throws `PopplerMissingError` (`POPPLER_MISSING`) naming the binaries that
 * could not be run, with an install hint.
 */
export async function popplerPreflight(options: PreflightOptions = {}): Promise<PopplerTools> {
  const runner = options.run ?? run;
  const binaries: Record<PopplerBinary, string> = {
    pdftotext: options.binaries?.pdftotext ?? 'pdftotext',
    pdftoppm: options.binaries?.pdftoppm ?? 'pdftoppm',
    pdfinfo: options.binaries?.pdfinfo ?? 'pdfinfo',
  };
  const versions: Record<PopplerBinary, string> = {
    pdftotext: 'unknown',
    pdftoppm: 'unknown',
    pdfinfo: 'unknown',
  };
  const missing: { binary: PopplerBinary; reason: string }[] = [];

  for (const binary of POPPLER_BINARIES) {
    try {
      // Every poppler tool prints its version to stderr and exits 0 for -v.
      const result = await runner(binaries[binary], ['-v'], {
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      });
      const text = `${result.stderr}${result.stdout.toString('utf8')}`;
      const match = VERSION.exec(text);
      versions[binary] = match === null ? 'unknown' : group(match, 1);
    } catch (error) {
      missing.push({ binary, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  if (missing.length > 0) {
    throw new PopplerMissingError(
      'POPPLER_MISSING',
      `cannot run ${missing.map((entry) => entry.binary).join(', ')}; ${INSTALL_HINT}`,
      { details: { missing } },
    );
  }
  return { binaries, versions };
}
