import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { DigiKeyApi, DigiKeyClient, FileTokenStore } from '../adapters/digikey/index.js';
import { MouserApi, MouserClient } from '../adapters/mouser/index.js';
import { Cache, FileCacheStore } from '../cache/index.js';
import type { Config } from '../config.js';
import type { Currency } from '../core/index.js';
import { createRepositories, openDatabase, type Db } from '../db/index.js';
import { ToolCallLedger, createRedactor, secretsFromConfig } from '../log/index.js';
import { PdfToolkit, popplerPreflight } from '../pdf/index.js';
import { DEFAULT_QUOTA_POLICY, type QuotaPolicy } from './policy.js';
import type { ToolContext } from './types.js';

export interface ToolContextOptions {
  readonly config: Config;
  /** Identifies this process in the ledger. */
  readonly sessionId?: string;
  readonly policy?: QuotaPolicy;
  /** Default true: nothing here can wait for a person. */
  readonly headless?: boolean;
  readonly now?: () => string;
  readonly newId?: () => string;
}

export interface BuiltToolContext {
  readonly context: ToolContext;
  /** Closed by the caller when the process ends. */
  readonly db: Db;
}

/**
 * Wires one tool context from configuration: the cache and its store, the
 * database, the PDF toolkit, the ledger, and whichever distributors have
 * credentials.
 *
 * A distributor with no credentials is left out rather than built and made to
 * fail on first use. The tools report it as unavailable, which is a fact
 * about the run rather than an error in the middle of one.
 */
export async function createToolContext(options: ToolContextOptions): Promise<BuiltToolContext> {
  const { config } = options;
  const store = new FileCacheStore(path.join(config.dataDir, 'cache'));
  const cache = new Cache({ store });
  const db = openDatabase(path.join(config.dataDir, 'chip.sqlite'));
  const repositories = createRepositories(db);
  const ledger = new ToolCallLedger({
    dir: path.join(config.dataDir, 'ledger'),
    sessionId: options.sessionId ?? randomUUID(),
    redact: createRedactor({ secrets: secretsFromConfig(config) }),
  });
  const toolkit = new PdfToolkit({ cache, store, tools: await popplerPreflight() });

  const digikey =
    config.digikey.clientId === undefined || config.digikey.clientSecret === undefined
      ? undefined
      : new DigiKeyApi({
          client: new DigiKeyClient({
            clientId: config.digikey.clientId,
            clientSecret: config.digikey.clientSecret,
            sandbox: config.digikey.sandbox,
            locale: config.digikey.locale,
            tokenStore: new FileTokenStore(path.join(config.dataDir, 'tokens', 'digikey.json')),
          }),
          cache,
          locale: config.digikey.locale,
          sandbox: config.digikey.sandbox,
          ledger,
        });

  const mouser =
    config.mouser.apiKey === undefined
      ? undefined
      : new MouserApi({
          client: new MouserClient({ apiKey: config.mouser.apiKey }),
          cache,
          ledger,
          fallbackCurrency: config.digikey.locale.currency as Currency,
        });

  return {
    db,
    context: {
      repositories,
      cache,
      toolkit,
      digikey,
      mouser,
      ledger,
      policy: options.policy ?? DEFAULT_QUOTA_POLICY,
      headless: options.headless ?? true,
      now: options.now ?? ((): string => new Date().toISOString()),
      newId: options.newId ?? randomUUID,
    },
  };
}
