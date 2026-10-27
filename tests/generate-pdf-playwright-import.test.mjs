// build-cv-html.mjs imports the guards on every HTML render. Loading the
// browser library as a side effect of that import made each render pay to
// parse Playwright before it wrote a single tag.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const PROBE = `
import { Module } from 'node:module';
const browserLoaded = () => Object.keys(Module._cache).some((key) => key.includes('/node_modules/playwright-core/'));
const { renderHtmlToPdf } = await import('./generate-pdf.mjs');
if (process.env.PDF_PROBE === 'import') {
  console.log(browserLoaded() ? 'loaded' : 'clean');
} else {
  try {
    await renderHtmlToPdf('<!DOCTYPE html><html><body><p>Example</p></body></html>', process.env.PDF_PROBE_OUT);
  } catch {
    // Launch fails when Chromium is not installed. The import already ran.
  }
  console.log(browserLoaded() ? 'loaded' : 'clean');
}
`;

function probe(phase) {
  const dir = mkdtempSync(join(tmpdir(), 'pdf-probe-'));
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', PROBE], {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 30_000,
      env: { ...process.env, PDF_PROBE: phase, PDF_PROBE_OUT: join(dir, 'out.pdf') },
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const line = result.stdout.trim().split('\n').at(-1);
    return line;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('importing generate-pdf.mjs does not load Playwright', () => {
  assert.equal(probe('import'), 'clean');
});

test('rendering a PDF loads Playwright', () => {
  assert.equal(probe('render'), 'loaded');
});
