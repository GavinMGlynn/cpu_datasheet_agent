#!/usr/bin/env node
import { main, SDK_QUERY } from '../src/agent/index.js';
import { loadEnvFileIfPresent } from '../src/config.js';
import { createToolContext } from '../src/tools/index.js';

loadEnvFileIfPresent();
process.exitCode = await main(process.argv.slice(2), {
  env: process.env,
  query: SDK_QUERY,
  out: (line: string) => process.stdout.write(`${line}\n`),
  createContext: createToolContext,
});
