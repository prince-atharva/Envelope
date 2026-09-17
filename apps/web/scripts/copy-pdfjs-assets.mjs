// Copies the files pdf.js loads at runtime (standard fonts, character maps,
// colour profiles and WebAssembly decoders) into public/pdfjs/, so documents that
// rely on non-embedded fonts render correctly. Runs on install, dev and build.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
const target = path.resolve(import.meta.dirname, '..', 'public', 'pdfjs');

rmSync(target, { recursive: true, force: true });
for (const folder of ['standard_fonts', 'cmaps', 'iccs', 'wasm']) {
  const source = path.join(pdfjsRoot, folder);
  if (existsSync(source)) cpSync(source, path.join(target, folder), { recursive: true });
}

const workerSource = path.join(pdfjsRoot, 'build', 'pdf.worker.min.mjs');
if (existsSync(workerSource)) cpSync(workerSource, path.join(target, 'pdf.worker.min.mjs'));
