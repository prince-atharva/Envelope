/**
 * A three-page PDF whose pages disagree with each other:
 *
 *   1  A4 portrait          595.28 x 841.89
 *   2  US Letter landscape  792 x 612
 *   3  A4 with /Rotate 90   displayed as landscape
 *
 * Field positions are ratios of each page, so a viewer that reads one page's
 * size and applies it to the others, or that ignores /Rotate, puts fields in
 * visibly wrong places here while looking perfect on a uniform document.
 */
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

  const label = (page, text) => {
    page.drawText(text, {
      x: 40,
      y: page.getHeight() - 60,
      size: 18,
      font,
      color: rgb(0.1, 0.1, 0.1),
    });
  };

  label(doc.addPage([595.28, 841.89]), 'Page 1 — A4 portrait');
  label(doc.addPage([792, 612]), 'Page 2 — Letter landscape');

  const rotated = doc.addPage([595.28, 841.89]);
  label(rotated, 'Page 3 — A4 rotated 90');
  rotated.setRotation({ type: 'degrees', angle: 90 });

  const bytes = await doc.save();
  writeFileSync(join(dir, 'mixed-pages.pdf'), bytes);
  // biome-ignore lint/suspicious/noConsole: CLI script output
  console.log(`Created mixed-pages.pdf (${bytes.length} bytes, 3 pages)`);
}

void main();
