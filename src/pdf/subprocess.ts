import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';

import { ChipAgentError } from '../errors.js';

export class SubprocessError extends ChipAgentError {}

/** The part of a child process this wrapper uses. Lets tests inject a fake. */
export interface SpawnedProcess {
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(
    event: 'close',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

export type Spawner = (
  bin: string,
  args: readonly string[],
  options: { cwd?: string },
) => SpawnedProcess;

export interface RunOptions {
  /** Killed with SIGKILL after this many milliseconds. Default 30000. */
  readonly timeoutMs?: number;
  /** Killed once stdout exceeds this many bytes. Default 64 MiB. */
  readonly maxOutputBytes?: number;
  readonly cwd?: string;
  /** Exit codes treated as success. Default `[0]`. */
  readonly allowExitCodes?: readonly number[];
  readonly spawner?: Spawner;
}

export interface RunResult {
  readonly stdout: Buffer;
  /** Captured stderr, truncated to the output cap. */
  readonly stderr: string;
  readonly code: number;
}

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

const defaultSpawner: Spawner = (bin, args, options) =>
  spawn(bin, [...args], options.cwd === undefined ? {} : { cwd: options.cwd });

function describe(bin: string, args: readonly string[]): string {
  return [bin, ...args].join(' ');
}

/**
 * Runs a command and collects its output.
 *
 * Kills the process and throws on timeout (`SUBPROCESS_TIMEOUT`) or when
 * stdout exceeds the cap (`SUBPROCESS_OUTPUT_TOO_LARGE`). A spawn failure is
 * `SUBPROCESS_SPAWN_FAILED`; an exit code outside `allowExitCodes` is
 * `SUBPROCESS_FAILED` with the code and captured stderr in `details`.
 */
export function run(
  bin: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<RunResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const allowed = options.allowExitCodes ?? [0];
  const spawner = options.spawner ?? defaultSpawner;
  const command = describe(bin, args);

  return new Promise<RunResult>((resolve, reject) => {
    let child: SpawnedProcess;
    try {
      child = spawner(bin, args, options.cwd === undefined ? {} : { cwd: options.cwd });
    } catch (error) {
      reject(
        new SubprocessError('SUBPROCESS_SPAWN_FAILED', `cannot start ${command}`, {
          cause: error,
          details: { bin, args: [...args] },
        }),
      );
      return;
    }

    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;
    let settled = false;

    const finish = (action: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      action();
    };

    const kill = (): void => {
      child.kill('SIGKILL');
    };

    const timer = setTimeout(() => {
      finish(() => {
        kill();
        reject(
          new SubprocessError(
            'SUBPROCESS_TIMEOUT',
            `${command} timed out after ${String(timeoutMs)} ms`,
            {
              details: { bin, args: [...args], timeoutMs },
            },
          ),
        );
      });
    }, timeoutMs);
    timer.unref();

    child.stdout?.on('data', (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes > maxOutputBytes) {
        finish(() => {
          kill();
          reject(
            new SubprocessError(
              'SUBPROCESS_OUTPUT_TOO_LARGE',
              `${command} produced more than ${String(maxOutputBytes)} bytes`,
              {
                details: { bin, args: [...args], maxOutputBytes },
              },
            ),
          );
        });
        return;
      }
      outChunks.push(chunk);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      if (errBytes < maxOutputBytes) {
        errBytes += chunk.length;
        errChunks.push(chunk);
      }
    });

    child.on('error', (error) => {
      finish(() => {
        reject(
          new SubprocessError('SUBPROCESS_SPAWN_FAILED', `cannot start ${command}`, {
            cause: error,
            details: { bin, args: [...args] },
          }),
        );
      });
    });

    child.on('close', (code, signal) => {
      finish(() => {
        const stderr = Buffer.concat(errChunks).toString('utf8');
        const exitCode = code ?? -1;
        if (!allowed.includes(exitCode)) {
          reject(
            new SubprocessError(
              'SUBPROCESS_FAILED',
              `${command} exited with code ${String(exitCode)}`,
              {
                details: {
                  bin,
                  args: [...args],
                  code: exitCode,
                  signal,
                  stderr: stderr.slice(0, 2000),
                },
              },
            ),
          );
          return;
        }
        resolve({ stdout: Buffer.concat(outChunks), stderr, code: exitCode });
      });
    });
  });
}

export type RunFn = typeof run;
