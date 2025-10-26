#!/usr/bin/env node
import {execSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const OUTPUT = resolve(ROOT, 'dist', 'build-info.json');

const run = cmd => {
  try {
    return execSync(cmd, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
};

const commit = process.env.GIT_COMMIT ?? run('git rev-parse --short HEAD');
const dirtyRaw = process.env.GIT_DIRTY ?? (() => {
  const status = run('git status --short');
  if (status === undefined) {
    return undefined;
  }
  return status.length > 0 ? 'true' : 'false';
})();

const info = {
  commit: commit ?? null,
  dirty: dirtyRaw != null ? dirtyRaw === 'true' : null,
  generatedAt: new Date().toISOString(),
};

writeFileSync(OUTPUT, JSON.stringify(info, null, 2));
console.log(`Wrote build info to ${OUTPUT}`);
