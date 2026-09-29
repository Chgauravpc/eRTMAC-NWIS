// PRD FE-17: no hardcoded well names outside fixtures/tests. Portable replacement for a grep one-liner.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SKIP_DIR = new Set(['mocks', 'test']);
const PATTERN = /SYN-|mock-wellbore-id/;
const hits = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIR.has(name)) walk(full);
    } else if (/\.(js|jsx)$/.test(name) && !/\.test\.(js|jsx)$/.test(name)) {
      readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
        if (PATTERN.test(line)) hits.push(`${full}:${i + 1}: ${line.trim()}`);
      });
    }
  }
}

walk(ROOT);
if (hits.length) {
  console.error('Hardcoded well names found outside mocks/tests:\n' + hits.join('\n'));
  process.exit(1);
}
console.log('check:hardcoded OK');
