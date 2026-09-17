import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(dir, '../../../../apps/api');
const require = createRequire(join(apiDir, 'package.json'));
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

async function main() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 12; i++) {
    const page = doc.addPage([595.28, 841.89]); // A4
    page.drawText(`Test Document — Page ${i} of 12`, {
      x: 50,
      y: 750,
      size: 24,
      font,
      color: rgb(0.1, 0.1, 0.1),
    });
    page.drawText(`This is a test page for automated Playwright E2E tests.`, {
      x: 50,
      y: 700,
      size: 14,
      font,
      color: rgb(0.3, 0.3, 0.3),
    });
  }
  const bytes = await doc.save();
  writeFileSync(join(dir, 'test-12-pages.pdf'), bytes);
  // biome-ignore lint/suspicious/noConsole: CLI script output
  console.log(`Created test-12-pages.pdf (${bytes.length} bytes, 12 pages)`);
}
void main();
