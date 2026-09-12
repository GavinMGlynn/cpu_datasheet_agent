import { createInterface } from 'node:readline/promises';

/**
 * The two things that need a real terminal.
 *
 * Kept in a file of their own, and excluded from coverage for the same
 * reason the browser entry point is: there is no decision here to test, only
 * the mechanics of turning the echo off and reading standard input to its
 * end. Everything with a judgement in it lives in `cli.ts`.
 */

/** Asks for a password without echoing it, so it is not left on the screen. */
export async function askPassword(prompt: string): Promise<string> {
  const output = process.stdout;
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  // The echo is turned off by swapping the stream's own write while the
  // answer is being typed, and put back in `finally` whatever happens.
  const stream = output as unknown as { write: (chunk: string) => boolean };
  const write = stream.write.bind(output);
  const muted = { on: false };
  stream.write = (chunk: string): boolean => (muted.on ? true : write(chunk));
  try {
    const answer = rl.question(prompt);
    muted.on = true;
    return await answer;
  } finally {
    muted.on = false;
    stream.write = write;
    output.write('\n');
    rl.close();
  }
}

/** Reads standard input to its end, for `--password-stdin`. */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf8');
}
