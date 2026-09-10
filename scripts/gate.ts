import { formatViolations, runGate } from '../src/gate/scan.js';

const result = await runGate(['src', 'test', 'scripts', 'bin'], { cwd: process.cwd() });
if (result.violations.length > 0) {
  console.error(formatViolations(result.violations));
  process.exit(1);
}
console.error(`gate: ${String(result.filesScanned)} files clean`);
