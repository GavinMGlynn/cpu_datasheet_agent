#!/usr/bin/env node
import { randomUUID } from 'node:crypto';

import { SDK_QUERY } from '../src/agent/index.js';
import { loadEnvFileIfPresent } from '../src/config.js';
import { main } from '../src/eval/index.js';
import { createToolContext } from '../src/tools/index.js';

loadEnvFileIfPresent();
process.exitCode = await main(process.argv.slice(2), {
  env: process.env,
  query: SDK_QUERY,
  out: (line: string) => process.stdout.write(`${line}\n`),
  createContext: createToolContext,
  newId: randomUUID,
});
