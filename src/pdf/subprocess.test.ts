import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  run,
  type SpawnedProcess,
  type Spawner,
  type SubprocessError,
} from './subprocess.js';

const NODE = process.execPath;

/** A child process that never exits, for timeout and cap tests. */
class FakeProcess extends EventEmitter implements SpawnedProcess {
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  killed: NodeJS.Signals | undefined;

  constructor(options: { stdout?: Readable | null; stderr?: Readable | null } = {}) {
    super();
    this.stdout =
      options.stdout === undefined ? new Readable({ read: () => undefined }) : options.stdout;
    this.stderr =
      options.stderr === undefined ? new Readable({ read: () => undefined }) : options.stderr;
  }

  kill(signal?: NodeJS.Signals): boolean {
    this.killed = signal;
    return true;
  }
}

function fakeSpawner(child: SpawnedProcess): Spawner {
  return () => child;
}

/** Streams deliver 'data' asynchronously; wait for that before closing. */
function delivered(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

describe('run against real processes', () => {
  it('captures stdout, stderr, and the exit code', async () => {
    const result = await run(NODE, [
      '-e',
      'process.stdout.write("out"); process.stderr.write("err")',
    ]);

    expect(result.stdout.toString()).toBe('out');
    expect(result.stderr).toBe('err');
    expect(result.code).toBe(0);
  });

  it('passes arguments through without a shell', async () => {
    const result = await run(NODE, [
      '-e',
      'process.stdout.write(process.argv[1] ?? "")',
      'a b; echo hi',
    ]);
    expect(result.stdout.toString()).toBe('a b; echo hi');
  });

  it('honours cwd', async () => {
    const result = await run(NODE, ['-e', 'process.stdout.write(process.cwd())'], { cwd: '/tmp' });
    expect(result.stdout.toString()).toBe('/tmp');
  });

  it('rejects a non-zero exit with the code and stderr', async () => {
    await expect(
      run(NODE, ['-e', 'process.stderr.write("bad input"); process.exit(3)']),
    ).rejects.toMatchObject({
      code: 'SUBPROCESS_FAILED',
      details: { code: 3, stderr: 'bad input' },
    });
  });

  it('accepts exit codes listed in allowExitCodes', async () => {
    const result = await run(NODE, ['-e', 'process.exit(1)'], { allowExitCodes: [0, 1] });
    expect(result.code).toBe(1);
  });

  it('reports a binary that does not exist', async () => {
    await expect(run('definitely-not-a-real-binary-xyz', [])).rejects.toMatchObject({
      code: 'SUBPROCESS_SPAWN_FAILED',
    });
  });

  it('kills and reports a process that overruns its timeout', async () => {
    await expect(
      run(NODE, ['-e', 'setTimeout(() => undefined, 10000)'], { timeoutMs: 100 }),
    ).rejects.toMatchObject({
      code: 'SUBPROCESS_TIMEOUT',
      details: { timeoutMs: 100 },
    });
  });

  it('kills and reports a process that exceeds the output cap', async () => {
    await expect(
      run(NODE, ['-e', 'setInterval(() => process.stdout.write("x".repeat(4096)), 1)'], {
        maxOutputBytes: 1024,
      }),
    ).rejects.toMatchObject({
      code: 'SUBPROCESS_OUTPUT_TOO_LARGE',
      details: { maxOutputBytes: 1024 },
    });
  });

  it('captures binary output intact', async () => {
    const result = await run(NODE, ['-e', 'process.stdout.write(Buffer.from([0, 1, 255, 254]))']);
    expect([...result.stdout]).toEqual([0, 1, 255, 254]);
  });

  it('exposes its defaults', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(30_000);
    expect(DEFAULT_MAX_OUTPUT_BYTES).toBe(64 * 1024 * 1024);
  });
});

describe('run with an injected spawner', () => {
  it('reports a spawner that throws synchronously', async () => {
    const spawner: Spawner = () => {
      throw new Error('no fork available');
    };

    await expect(run('x', [], { spawner })).rejects.toMatchObject({
      code: 'SUBPROCESS_SPAWN_FAILED',
      details: { bin: 'x', args: [] },
    });
  });

  it('reports an error event', async () => {
    const child = new FakeProcess();
    const promise = run('x', ['-a'], { spawner: fakeSpawner(child) });
    child.emit('error', new Error('EACCES'));

    await expect(promise).rejects.toMatchObject({
      code: 'SUBPROCESS_SPAWN_FAILED',
      details: { args: ['-a'] },
    });
  });

  it('tolerates a process with no stdout or stderr streams', async () => {
    const child = new FakeProcess({ stdout: null, stderr: null });
    const promise = run('x', [], { spawner: fakeSpawner(child) });
    child.emit('close', 0, null);

    await expect(promise).resolves.toEqual({ stdout: Buffer.alloc(0), stderr: '', code: 0 });
  });

  it('treats a process killed by a signal as exit code -1', async () => {
    const child = new FakeProcess();
    const promise = run('x', [], { spawner: fakeSpawner(child) });
    child.emit('close', null, 'SIGKILL');

    await expect(promise).rejects.toMatchObject({
      code: 'SUBPROCESS_FAILED',
      details: { code: -1, signal: 'SIGKILL' },
    });
  });

  it('kills with SIGKILL on timeout', async () => {
    const child = new FakeProcess();
    const promise = run('x', [], { timeoutMs: 10, spawner: fakeSpawner(child) });

    await expect(promise).rejects.toMatchObject({ code: 'SUBPROCESS_TIMEOUT' });
    expect(child.killed).toBe('SIGKILL');
  });

  it('ignores a close event that arrives after a timeout', async () => {
    const child = new FakeProcess();
    const promise = run('x', [], { timeoutMs: 10, spawner: fakeSpawner(child) });
    await expect(promise).rejects.toMatchObject({ code: 'SUBPROCESS_TIMEOUT' });

    expect(() => {
      child.emit('close', 0, null);
    }).not.toThrow();
  });

  it('caps captured stderr at the output limit', async () => {
    const stderr = new Readable({ read: () => undefined });
    const child = new FakeProcess({ stderr });
    const promise = run('x', [], { maxOutputBytes: 8, spawner: fakeSpawner(child) });
    stderr.push(Buffer.from('12345678'));
    stderr.push(Buffer.from('ignored beyond the cap'));
    await delivered();
    child.emit('close', 0, null);

    await expect(promise).resolves.toMatchObject({ stderr: '12345678' });
  });

  it('truncates stderr in the failure details', async () => {
    const stderr = new Readable({ read: () => undefined });
    const child = new FakeProcess({ stderr });
    const promise = run('x', [], { spawner: fakeSpawner(child) });
    stderr.push(Buffer.from('e'.repeat(3000)));
    await delivered();
    child.emit('close', 1, null);

    await expect(promise).rejects.toMatchObject({ code: 'SUBPROCESS_FAILED' });
    try {
      await promise;
    } catch (error) {
      expect((error as SubprocessError).details.stderr).toHaveLength(2000);
    }
  });
});
