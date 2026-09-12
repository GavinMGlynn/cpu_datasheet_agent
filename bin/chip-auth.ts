#!/usr/bin/env node
import { loadEnvFileIfPresent } from '../src/config.js';
import { main } from '../src/auth/cli.js';
import { askPassword, readStdin } from '../src/auth/terminal.js';

loadEnvFileIfPresent();
process.exitCode = await main(process.argv.slice(2), {
  env: process.env,
  out: (line: string) => {
    process.stdout.write(`${line}\n`);
  },
  askPassword,
  readStdin,
});
