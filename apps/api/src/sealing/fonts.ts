import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The fonts written into signed documents: Noto Sans, under the SIL Open Font
 * License (assets/fonts/OFL.txt). Standard PDF fonts only encode Windows-1252,
 * so a name or an answer outside it would make pdf-lib throw and the seal fail
 * (docs/15, ADR 0005). Embedded as a subset, so only the glyphs used are stored.
 *
 * The files sit in apps/api/assets/fonts. This module is at src/sealing in the
 * source and at <out>/sealing once compiled, so the same relative path works
 * from both.
 */
const FONT_DIR = path.resolve(__dirname, '..', '..', 'assets', 'fonts');

export type FontName = 'regular' | 'bold';

const FILES: Record<FontName, string> = {
  regular: 'NotoSans-Regular.ttf',
  bold: 'NotoSans-Bold.ttf',
};

const cache = new Map<FontName, Uint8Array>();

/** The font file's bytes, read once per process. */
export function fontBytes(name: FontName): Uint8Array {
  let bytes = cache.get(name);
  if (!bytes) {
    bytes = new Uint8Array(readFileSync(path.join(FONT_DIR, FILES[name])));
    cache.set(name, bytes);
  }
  return bytes;
}
