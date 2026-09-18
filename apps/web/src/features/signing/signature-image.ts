import {
  MAX_SIGNATURE_IMAGE_BYTES,
  MAX_SIGNATURE_IMAGE_DIMENSION,
  PNG_DATA_URL_PREFIX,
} from '@envelope/shared';

/**
 * Turning a drawn or typed signature into the image the server stores
 * (docs/06, docs/09): a transparent PNG, never JPEG, cropped to the ink and
 * under 500 KB. Drawn and typed signatures both come out of a canvas through
 * the same steps here, so everything downstream treats them alike.
 */

/** Dark blue, as from a pen: clearly a signature, and still dark enough to read in a fax or copy. */
export const INK_COLOUR = '#1e3a8a';

/** Handwriting faces for typed signatures, self-hosted (docs/09). */
export const SIGNATURE_FONTS = [
  { family: 'Dancing Script', label: 'Flowing' },
  { family: 'Great Vibes', label: 'Formal' },
  { family: 'Caveat', label: 'Casual' },
] as const;
export type SignatureFont = (typeof SIGNATURE_FONTS)[number]['family'];

/** Font size, in CSS pixels, a typed signature is drawn at before scaling. */
const TYPED_FONT_PX = 72;
/** Drawn at twice the size, so it stays sharp in the finished PDF. */
const TYPED_SCALE = 2;
/** Space left around the ink after cropping, in canvas pixels. */
const CROP_PADDING = 8;

export interface InkBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The smallest box around every pixel that is not fully transparent, or null
 * for an empty canvas. `data` is RGBA, as from getImageData.
 */
export function inkBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): InkBounds | null {
  let top = height;
  let bottom = -1;
  let left = width;
  let right = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((data[(y * width + x) * 4 + 3] ?? 0) === 0) continue;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  if (bottom < 0) return null;
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/** Bytes of image data in a base64 data URL. */
export function dataUrlBytes(dataUrl: string): number {
  const encoded = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  return (encoded.length * 3) / 4 - padding;
}

/** "Priya Sharma" → "PS", "raj" → "R". At most three letters. */
export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => Array.from(part)[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 3);
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  return ctx;
}

/** A copy of the canvas cut down to its ink plus a little padding, or null if it is blank. */
export function cropToInk(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
  const image = context(canvas).getImageData(0, 0, canvas.width, canvas.height);
  const bounds = inkBounds(image.data, canvas.width, canvas.height);
  if (!bounds) return null;
  const cropped = document.createElement('canvas');
  cropped.width = bounds.width + CROP_PADDING * 2;
  cropped.height = bounds.height + CROP_PADDING * 2;
  context(cropped).drawImage(
    canvas,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    CROP_PADDING,
    CROP_PADDING,
    bounds.width,
    bounds.height,
  );
  return cropped;
}

function scaled(canvas: HTMLCanvasElement, factor: number): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(canvas.width * factor));
  out.height = Math.max(1, Math.round(canvas.height * factor));
  const ctx = context(out);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}

/**
 * The canvas as a PNG data URL the server will accept: no side over the
 * dimension limit, and scaled down step by step until it is under 500 KB
 * (docs/09, "Payload cap").
 */
export function toSignaturePng(canvas: HTMLCanvasElement): string {
  let source = canvas;
  const longest = Math.max(source.width, source.height);
  if (longest > MAX_SIGNATURE_IMAGE_DIMENSION) {
    source = scaled(source, MAX_SIGNATURE_IMAGE_DIMENSION / longest);
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const url = source.toDataURL('image/png');
    if (!url.startsWith(PNG_DATA_URL_PREFIX)) throw new Error('The browser did not produce a PNG');
    if (dataUrlBytes(url) <= MAX_SIGNATURE_IMAGE_BYTES) return url;
    source = scaled(source, 0.75);
  }
  throw new Error('The signature image could not be made small enough');
}

function fontSpec(family: SignatureFont, px: number): string {
  return `${px}px "${family}"`;
}

/**
 * Draws typed text in a handwriting face onto a transparent canvas, cropped to
 * the ink. Waits for the face to load first: drawing before it arrives would
 * quietly use a fallback font and adopt the wrong signature.
 */
export async function renderTypedSignature(
  text: string,
  family: SignatureFont,
): Promise<HTMLCanvasElement | null> {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  await document.fonts.load(fontSpec(family, TYPED_FONT_PX), trimmed);

  const canvas = document.createElement('canvas');
  const measure = context(canvas);
  measure.font = fontSpec(family, TYPED_FONT_PX);
  const metrics = measure.measureText(trimmed);
  // Script faces reach well outside their advance width, so the canvas is
  // sized from the ink's own extent plus a generous margin, then cropped.
  const margin = TYPED_FONT_PX * 0.5;
  const left = Math.max(metrics.actualBoundingBoxLeft, 0) + margin;
  const ascent = Math.max(metrics.actualBoundingBoxAscent, TYPED_FONT_PX) + margin;
  const width = left + Math.max(metrics.actualBoundingBoxRight, metrics.width) + margin;
  const height = ascent + Math.max(metrics.actualBoundingBoxDescent, TYPED_FONT_PX * 0.4) + margin;

  canvas.width = Math.ceil(width * TYPED_SCALE);
  canvas.height = Math.ceil(height * TYPED_SCALE);
  // Resizing resets the context, so the font is set again.
  const ctx = context(canvas);
  ctx.scale(TYPED_SCALE, TYPED_SCALE);
  ctx.font = fontSpec(family, TYPED_FONT_PX);
  ctx.fillStyle = INK_COLOUR;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(trimmed, left, ascent);
  return cropToInk(canvas);
}
