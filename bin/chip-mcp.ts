#!/usr/bin/env node
import { loadEnvFileIfPresent } from '../src/config.js';
import { serveMcpStdio } from '../src/mcp/index.js';

loadEnvFileIfPresent();
await serveMcpStdio();
