#!/usr/bin/env node
import { loadEnvFileIfPresent } from '../src/config.js';
import { main } from '../src/web/cli.js';

loadEnvFileIfPresent();
process.exitCode = await main(process.argv.slice(2), {
  env: process.env,
  out: (line: string) => process.stdout.write(`${line}\n`),
});
