/**
 * The single source of truth for field coordinate conversion.
 *
 * Both the browser (placing a box on a rendered page) and the server (burning a
 * signature into a PDF) import from here. **Do not reimplement any of this
 * arithmetic elsewhere**, and do not inline a formula "just this once": two
 * copies drifting apart is how signatures start landing in the wrong place.
 *
 * The rules are recorded in docs/adr/0002-store-field-coordinates-as-ratios.md
 * and derived in docs/06-signing-and-document-sealing.md:
 *
 *   - Positions are stored only as ratios of the page, never pixels or points.
 *   - The origin is the page's TOP-LEFT corner, Y growing downward, as in the
 *     browser. `ratiosToPdfRect` inverts Y for PDF space.
 *   - The reference page is the DISPLAYED page: the pdf.js viewport at scale 1,
 *     which already applies /Rotate and the CropBox.
 *   - Ratios are rounded to RATIO_DECIMALS, so the same box gives the same
 *     numbers at any zoom level.
 *
 * Three spaces appear here. Variable names always say which one they are in:
 *
 *   ratios  0..1 of the page          ratioX, ratioY, ratioWidth, ratioHeight
 *   points  PDF points, 1/72 inch     xPt, widthPt      (interaction + sealing)
 *   pixels  CSS pixels on screen      cssWidth, left    (rendering only)
 */

/** A field's position and size, as fractions of its page. */
export interface Ratios {
  ratioX: number;
  ratioY: number;
  ratioWidth: number;
  ratioHeight: number;
}

/** A rectangle in PDF points. */
export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A rectangle in CSS pixels, measured from a page's top-left corner. */
export interface PixelBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * A page's size in PDF points, as displayed.
 *
 * In the browser this comes from `page.getViewport({ scale: 1 })`, never from
 * `getBoundingClientRect()` on a wrapper: wrappers pick up padding, borders and
 * scrollbars, and those errors are invisible in testing but misplace fields by a
 * few points every time (docs/06, gotcha 12).
 */
export interface PageSize {
  widthPt: number;
  heightPt: number;
}

export type FieldType = 'SIGNATURE' | 'INITIALS' | 'DATE_SIGNED' | 'TEXT_INPUT' | 'CHECKBOX';

/**
 * Stored ratios are rounded to this many decimals.
 *
 * 1e-6 of an A4 page is 0.0008pt: far below the 1pt placement tolerance, and
 * enough to make two placements of the same box compare equal with `===`.
 */
export const RATIO_DECIMALS = 6;

/** Ratios may exceed 1 by this much before they are rejected, to absorb float error. */
export const RATIO_EPSILON = 1e-6;

/** Placement grid, in points (docs/09). Hold Alt while dragging to bypass it. */
export const SNAP_GRID_PT = 4;

/** An alignment guide appears when two edges are within this many points. */
export const GUIDE_TOLERANCE_PT = 3;

/** Arrow key, and Shift + arrow key, in points. */
export const NUDGE_PT = 1;
export const NUDGE_LARGE_PT = 10;

/**
 * Size a newly dropped field gets, in points.
 *
 * A signature box is 150 × 40pt, roughly 5.3 × 1.4cm: the size of a handwritten
 * signature on paper, so a dropped box looks right before it is touched.
 */
export const DEFAULT_FIELD_SIZE_PT: Record<FieldType, { widthPt: number; heightPt: number }> = {
  SIGNATURE: { widthPt: 150, heightPt: 40 },
  INITIALS: { widthPt: 60, heightPt: 30 },
  DATE_SIGNED: { widthPt: 90, heightPt: 20 },
  TEXT_INPUT: { widthPt: 150, heightPt: 20 },
  CHECKBOX: { widthPt: 16, heightPt: 16 },
};

/**
 * Smallest size a field may be resized to, in points.
 *
 * docs/09 gives one rule, 40 × 15pt. That is right for anything holding a mark
 * or text, but a checkbox is square and would be forced into a wide, ugly box,
 * so it has its own minimum.
 */
export const MIN_FIELD_SIZE_PT: Record<FieldType, { widthPt: number; heightPt: number }> = {
  SIGNATURE: { widthPt: 40, heightPt: 15 },
  INITIALS: { widthPt: 40, heightPt: 15 },
  DATE_SIGNED: { widthPt: 40, heightPt: 15 },
  TEXT_INPUT: { widthPt: 40, heightPt: 15 },
  CHECKBOX: { widthPt: 10, heightPt: 10 },
};

/** Rounds one ratio to the stored precision. */
export function roundRatio(value: number): number {
  const factor = 10 ** RATIO_DECIMALS;
  return Math.round(value * factor) / factor;
}

/** Rounds all four ratios of a field. */
export function roundRatios(r: Ratios): Ratios {
  return {
    ratioX: roundRatio(r.ratioX),
    ratioY: roundRatio(r.ratioY),
    ratioWidth: roundRatio(r.ratioWidth),
    ratioHeight: roundRatio(r.ratioHeight),
  };
}

/**
 * Browser: a rendered pixel box -> ratios.
 *
 * `renderedPageWidth/Height` MUST be the pdf.js viewport size at the current
 * scale, in CSS pixels.
 */
export function pixelsToRatios(
  box: PixelBox,
  renderedPageWidth: number,
  renderedPageHeight: number,
): Ratios {
  assertPositive(renderedPageWidth, 'renderedPageWidth');
  assertPositive(renderedPageHeight, 'renderedPageHeight');
  return roundRatios({
    ratioX: box.left / renderedPageWidth,
    ratioY: box.top / renderedPageHeight,
    ratioWidth: box.width / renderedPageWidth,
    ratioHeight: box.height / renderedPageHeight,
  });
}

/**
 * Browser: ratios -> a pixel box for rendering the overlay.
 *
 * Not rounded: this value only positions a div, and rounding it would make the
 * box drift against the page as the user zooms.
 */
export function ratiosToPixels(
  r: Ratios,
  renderedPageWidth: number,
  renderedPageHeight: number,
): PixelBox {
  return {
    left: r.ratioX * renderedPageWidth,
    top: r.ratioY * renderedPageHeight,
    width: r.ratioWidth * renderedPageWidth,
    height: r.ratioHeight * renderedPageHeight,
  };
}

/**
 * Builder: ratios -> a rectangle in points, measured from the page's top-left.
 *
 * This is the space the builder does all of its geometry in, because a point is
 * the same size whatever the zoom level. Y still grows downward here; only
 * `ratiosToPdfRect` flips it.
 */
export function ratiosToPoints(r: Ratios, page: PageSize): PdfRect {
  return {
    x: r.ratioX * page.widthPt,
    y: r.ratioY * page.heightPt,
    width: r.ratioWidth * page.widthPt,
    height: r.ratioHeight * page.heightPt,
  };
}

/** Builder: a top-left rectangle in points -> ratios. */
export function pointsToRatios(rect: PdfRect, page: PageSize): Ratios {
  assertPositive(page.widthPt, 'page.widthPt');
  assertPositive(page.heightPt, 'page.heightPt');
  return roundRatios({
    ratioX: rect.x / page.widthPt,
    ratioY: rect.y / page.heightPt,
    ratioWidth: rect.width / page.widthPt,
    ratioHeight: rect.height / page.heightPt,
  });
}

/**
 * Server: ratios -> PDF points, with the Y axis inverted.
 *
 * `ratioY` marks the box's TOP edge, measured downward; pdf-lib positions by the
 * BOTTOM-LEFT corner. So the origin is flipped and then the height is
 * subtracted to re-anchor from the top edge to the bottom edge. Leave the
 * subtraction out and every field sits exactly one box-height too high: barely
 * noticeable on a large field, glaring on a small one (docs/06).
 *
 * For a page with /Rotate 90 or 270, pass the swapped width and height, so that
 * this matches the page as the sender saw it.
 */
export function ratiosToPdfRect(r: Ratios, pdfWidth: number, pdfHeight: number): PdfRect {
  const width = r.ratioWidth * pdfWidth;
  const height = r.ratioHeight * pdfHeight;
  return {
    x: r.ratioX * pdfWidth,
    y: pdfHeight - r.ratioY * pdfHeight - height,
    width,
    height,
  };
}

/**
 * Fits an image inside a box, keeping its aspect ratio, centred.
 *
 * REQUIRED for signatures (docs/06, "Correction 1"). Trimming a signature image
 * changes its aspect ratio, so drawing it at the box's raw size stretches the
 * handwriting.
 */
export function fitPreservingAspect(box: PdfRect, imgWidth: number, imgHeight: number): PdfRect {
  assertPositive(imgWidth, 'imgWidth');
  assertPositive(imgHeight, 'imgHeight');
  const scale = Math.min(box.width / imgWidth, box.height / imgHeight);
  const width = imgWidth * scale;
  const height = imgHeight * scale;
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  };
}

/**
 * Rounds a length in points to the placement grid.
 *
 * Snapping happens in points, never in pixels: a pixel is a different size at
 * every zoom level, so snapping there would store a different ratio depending on
 * how far the user had zoomed in.
 */
export function snapToGrid(valuePt: number, gridPt: number = SNAP_GRID_PT): number {
  if (gridPt <= 0) return valuePt;
  return Math.round(valuePt / gridPt) * gridPt;
}

/** Moves a rectangle back inside the page, keeping its size. */
export function clampRectToPage(rect: PdfRect, page: PageSize): PdfRect {
  const width = Math.min(rect.width, page.widthPt);
  const height = Math.min(rect.height, page.heightPt);
  return {
    width,
    height,
    x: clamp(rect.x, 0, page.widthPt - width),
    y: clamp(rect.y, 0, page.heightPt - height),
  };
}

/**
 * Grows a rectangle to the field type's minimum size, without leaving the page.
 *
 * `anchor` is the corner held still while resizing, so a box resized from its
 * top-left edge grows in the direction the user is dragging.
 */
export function enforceMinSize(
  rect: PdfRect,
  type: FieldType,
  page: PageSize,
  anchor: 'top-left' | 'bottom-right' = 'top-left',
): PdfRect {
  const min = MIN_FIELD_SIZE_PT[type];
  const width = Math.min(Math.max(rect.width, min.widthPt), page.widthPt);
  const height = Math.min(Math.max(rect.height, min.heightPt), page.heightPt);
  const grown: PdfRect =
    anchor === 'top-left'
      ? { x: rect.x, y: rect.y, width, height }
      : {
          x: rect.x + rect.width - width,
          y: rect.y + rect.height - height,
          width,
          height,
        };
  return clampRectToPage(grown, page);
}

/** A rectangle in points for a field just dropped at a point on the page, centred there. */
export function defaultRectAt(
  type: FieldType,
  centre: { xPt: number; yPt: number },
  page: PageSize,
): PdfRect {
  const size = DEFAULT_FIELD_SIZE_PT[type];
  return clampRectToPage(
    {
      x: snapToGrid(centre.xPt - size.widthPt / 2),
      y: snapToGrid(centre.yPt - size.heightPt / 2),
      width: size.widthPt,
      height: size.heightPt,
    },
    page,
  );
}

export type RatioProblem = 'RATIO_OUT_OF_RANGE' | 'FIELD_EXCEEDS_PAGE';

/**
 * Checks one field's ratios. Returns null when they are valid.
 *
 * Both the API and the builder call this, so a box the UI marks red is exactly
 * the box the server would reject. The database has the same two constraints.
 */
export function validateRatios(r: Ratios): RatioProblem | null {
  const values = [r.ratioX, r.ratioY, r.ratioWidth, r.ratioHeight];
  if (values.some((v) => !Number.isFinite(v))) return 'RATIO_OUT_OF_RANGE';
  if (r.ratioX < 0 || r.ratioX > 1 || r.ratioY < 0 || r.ratioY > 1) return 'RATIO_OUT_OF_RANGE';
  // A zero-width or zero-height field would be invisible and unclickable.
  if (r.ratioWidth <= 0 || r.ratioWidth > 1 || r.ratioHeight <= 0 || r.ratioHeight > 1) {
    return 'RATIO_OUT_OF_RANGE';
  }
  if (r.ratioX + r.ratioWidth > 1 + RATIO_EPSILON) return 'FIELD_EXCEEDS_PAGE';
  if (r.ratioY + r.ratioHeight > 1 + RATIO_EPSILON) return 'FIELD_EXCEEDS_PAGE';
  return null;
}

export interface AlignmentGuide {
  axis: 'x' | 'y';
  /** Where to draw the line, in points from the page's top-left corner. */
  positionPt: number;
}

/**
 * Finds the edges and centres of `others` that the moving rectangle lines up
 * with, within GUIDE_TOLERANCE_PT.
 *
 * Purely a visual aid: it reports where to draw the guide lines and never moves
 * anything, so it cannot change what is stored.
 */
export function findAlignmentGuides(
  moving: PdfRect,
  others: readonly PdfRect[],
  tolerancePt: number = GUIDE_TOLERANCE_PT,
): AlignmentGuide[] {
  const guides: AlignmentGuide[] = [];
  const movingX = [moving.x, moving.x + moving.width / 2, moving.x + moving.width];
  const movingY = [moving.y, moving.y + moving.height / 2, moving.y + moving.height];

  for (const other of others) {
    for (const position of [other.x, other.x + other.width / 2, other.x + other.width]) {
      if (movingX.some((v) => Math.abs(v - position) <= tolerancePt)) {
        guides.push({ axis: 'x', positionPt: position });
      }
    }
    for (const position of [other.y, other.y + other.height / 2, other.y + other.height]) {
      if (movingY.some((v) => Math.abs(v - position) <= tolerancePt)) {
        guides.push({ axis: 'y', positionPt: position });
      }
    }
  }

  return dedupeGuides(guides);
}

function dedupeGuides(guides: readonly AlignmentGuide[]): AlignmentGuide[] {
  const seen = new Set<string>();
  const unique: AlignmentGuide[] = [];
  for (const guide of guides) {
    const key = `${guide.axis}:${guide.positionPt.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(guide);
  }
  return unique;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function assertPositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive number, received ${value}`);
  }
}
