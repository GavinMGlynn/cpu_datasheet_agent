import type { ToolCallLedger } from './ledger.js';

export interface LedgerToolMeta {
  readonly name: string;
  readonly spendsQuota: boolean;
}

export interface CallContext {
  readonly callId: string;
}

export type LedgeredHandler<I, O> = (input: I, parentId?: string) => Promise<O>;

/**
 * Wraps a tool handler so every invocation is recorded: begun before the
 * handler runs, ended with its output or its thrown error, which is rethrown
 * unchanged after the record is on disk.
 */
export function withLedger<I, O>(
  ledger: ToolCallLedger,
  meta: LedgerToolMeta,
  handler: (input: I, context: CallContext) => Promise<O>,
): LedgeredHandler<I, O> {
  return async (input, parentId) => {
    const callId = ledger.begin(meta.name, input, {
      spendsQuota: meta.spendsQuota,
      ...(parentId === undefined ? {} : { parentId }),
    });
    let output: O;
    try {
      output = await handler(input, { callId });
    } catch (error) {
      await ledger.end(callId, { error });
      throw error;
    }
    await ledger.end(callId, { output });
    return output;
  };
}
