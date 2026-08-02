/**
 * Copy the DuckDB-WASM runtime into `public/duckdb` so the browser engine can be
 * served statically.
 *
 * The app is built with `output: 'export'` and published under a GitHub Pages
 * base path, so we cannot rely on a bundler to emit the `.wasm` module or the
 * worker script: webpack asset URLs and `import.meta.url` both resolve relative
 * to the JS chunk, which breaks under a subpath. Serving the runtime from
 * `public/` instead gives us stable, predictable URLs that we prefix with
 * NEXT_PUBLIC_BASE_PATH at runtime.
 *
 * Keeping the worker same-origin also avoids the cross-origin `new Worker()`
 * restriction that a CDN-hosted bundle would run into.
 */
import { cpSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const src = join(root, 'node_modules', '@duckdb', 'duckdb-wasm', 'dist');
const dest = join(root, 'public', 'duckdb');

const ASSETS = [
  'duckdb-mvp.wasm',
  'duckdb-browser-mvp.worker.js',
  'duckdb-eh.wasm',
  'duckdb-browser-eh.worker.js',
];

if (!existsSync(src)) {
  console.error(`[duckdb] runtime not found at ${src} - run npm install first.`);
  process.exit(1);
}

mkdirSync(dest, { recursive: true });
let total = 0;
for (const asset of ASSETS) {
  const from = join(src, asset);
  if (!existsSync(from)) {
    console.error(`[duckdb] missing asset ${asset}`);
    process.exit(1);
  }
  cpSync(from, join(dest, asset));
  total += statSync(from).size;
}
console.log(`[duckdb] copied ${ASSETS.length} assets (${(total / 1024 / 1024).toFixed(1)} MB) to public/duckdb`);
