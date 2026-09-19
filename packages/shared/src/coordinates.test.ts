import { describe, expect, it } from 'vitest';
import {
  clampRectToPage,
  defaultRectAt,
  displayedPageSize,
  displayedPointToPdf,
  enforceMinSize,
  findAlignmentGuides,
  fitPreservingAspect,
  normaliseRotation,
  type PageGeometry,
  type PageSize,
  pdfPointToDisplayed,
  pixelsToRatios,
  pointsToRatios,
  type Ratios,
  ratiosToPdfRect,
  ratiosToPixels,
  ratiosToPoints,
  roundRatio,
  snapToGrid,
  validateRatios,
  visibleBox,
} from './coordinates';

const A4: PageSize = { widthPt: 595.28, heightPt: 841.89 };
const LETTER: PageSize = { widthPt: 612, heightPt: 792 };
/** An A4 page with /Rotate 90: pdf.js reports the viewport already swapped. */
const A4_LANDSCAPE: PageSize = { widthPt: 841.89, heightPt: 595.28 };

describe('pixelsToRatios', () => {
  it('divides by the rendered page size', () => {
    // A 100x50 box at (200, 400) on an A4 page rendered at scale 1.
    const r = pixelsToRatios({ left: 200, top: 400, width: 100, height: 50 }, 595.28, 841.89);

    expect(r.ratioX).toBe(roundRatio(200 / 595.28)); //  0.335976
    expect(r.ratioY).toBe(roundRatio(400 / 841.89)); //  0.475122
    expect(r.ratioWidth).toBe(roundRatio(100 / 595.28));
    expect(r.ratioHeight).toBe(roundRatio(50 / 841.89));
  });

  it('gives 0 at the top-left corner and 1 at the far edges', () => {
    const corner = pixelsToRatios(
      { left: 0, top: 0, width: 595.28, height: 841.89 },
      595.28,
      841.89,
    );

    expect(corner).toEqual({ ratioX: 0, ratioY: 0, ratioWidth: 1, ratioHeight: 1 });
  });

  it('refuses a page size of zero rather than returning Infinity', () => {
    expect(() => pixelsToRatios({ left: 0, top: 0, width: 1, height: 1 }, 0, 800)).toThrow(
      RangeError,
    );
  });
});

describe('zoom independence', () => {
  // The exit criterion for Phase 2 (docs/11): the same field placed at 100% and
  // at 200% must store byte-identical ratios. The builder works in points, so
  // zoom only changes the pixels-per-point divisor.
  const rectPt = { x: 148, y: 320, width: 150, height: 40 };

  it('produces identical ratios from points at any zoom', () => {
    const atOne = pointsToRatios(rectPt, A4);
    const atTwo = pointsToRatios(rectPt, A4);

    expect(atOne).toEqual(atTwo);
    for (const key of Object.keys(atOne) as (keyof Ratios)[]) {
      expect(Object.is(atOne[key], atTwo[key])).toBe(true);
    }
  });

  it('produces identical ratios from pixels measured at 100% and at 200%', () => {
    const scales = [1, 2, 1.25, 3];
    const results = scales.map((scale) =>
      pixelsToRatios(
        {
          left: rectPt.x * scale,
          top: rectPt.y * scale,
          width: rectPt.width * scale,
          height: rectPt.height * scale,
        },
        A4.widthPt * scale,
        A4.heightPt * scale,
      ),
    );

    for (const r of results) {
      expect(r).toEqual(results[0]);
    }
  });

  it('snaps to the same grid position whatever the zoom', () => {
    // 7px of movement at 200% is 3.5pt, which snaps to 4pt either way.
    const movedAt100 = snapToGrid(100 + 7 / 1);
    const movedAt200 = snapToGrid(100 + 14 / 2);

    expect(movedAt100).toBe(movedAt200);
    expect(movedAt100 % 4).toBe(0);
  });
});

describe('round trip', () => {
  it('returns to the same pixels through ratios and back', () => {
    const box = { left: 120, top: 240, width: 150, height: 40 };
    const r = pixelsToRatios(box, A4.widthPt, A4.heightPt);
    const back = ratiosToPixels(r, A4.widthPt, A4.heightPt);

    expect(back.left).toBeCloseTo(box.left, 3);
    expect(back.top).toBeCloseTo(box.top, 3);
    expect(back.width).toBeCloseTo(box.width, 3);
    expect(back.height).toBeCloseTo(box.height, 3);
  });

  it('returns to the same points through ratios and back', () => {
    const rect = { x: 48, y: 96, width: 150, height: 40 };
    const back = ratiosToPoints(pointsToRatios(rect, LETTER), LETTER);

    expect(back.x).toBeCloseTo(rect.x, 3);
    expect(back.y).toBeCloseTo(rect.y, 3);
    expect(back.width).toBeCloseTo(rect.width, 3);
    expect(back.height).toBeCloseTo(rect.height, 3);
  });

  it('keeps a rendered pixel box within a point of itself on a 200% render', () => {
    const box = { left: 200.5, top: 611.25, width: 149.5, height: 41 };
    const r = pixelsToRatios(box, A4.widthPt * 2, A4.heightPt * 2);
    const back = ratiosToPixels(r, A4.widthPt * 2, A4.heightPt * 2);

    expect(Math.abs(back.left - box.left)).toBeLessThan(0.01);
    expect(Math.abs(back.top - box.top)).toBeLessThan(0.01);
  });
});

describe('ratiosToPdfRect', () => {
  it('inverts Y and re-anchors to the bottom-left corner', () => {
    // A 40pt-tall box whose top edge is 100pt down an 800pt page has its
    // bottom edge at 800 - 100 - 40 = 660pt from the bottom.
    const page = { widthPt: 600, heightPt: 800 };
    const r = pointsToRatios({ x: 60, y: 100, width: 120, height: 40 }, page);
    const rect = ratiosToPdfRect(r, page.widthPt, page.heightPt);

    expect(rect.x).toBeCloseTo(60, 3);
    expect(rect.y).toBeCloseTo(660, 3);
    expect(rect.width).toBeCloseTo(120, 3);
    expect(rect.height).toBeCloseTo(40, 3);
  });

  it('places a box at the very top of the page flush against the top edge', () => {
    const rect = ratiosToPdfRect(
      { ratioX: 0, ratioY: 0, ratioWidth: 0.5, ratioHeight: 0.1 },
      600,
      800,
    );

    // Top edge at the page top: the bottom edge is one box-height below it.
    expect(rect.y).toBeCloseTo(800 - 80, 3);
  });

  it('places a box at the bottom of the page at y = 0', () => {
    const rect = ratiosToPdfRect(
      { ratioX: 0, ratioY: 0.9, ratioWidth: 0.5, ratioHeight: 0.1 },
      600,
      800,
    );

    expect(rect.y).toBeCloseTo(0, 6);
  });

  it('places a box in the middle of the page symmetrically', () => {
    const rect = ratiosToPdfRect(
      { ratioX: 0.25, ratioY: 0.45, ratioWidth: 0.5, ratioHeight: 0.1 },
      600,
      800,
    );

    // Centred: the same distance above and below.
    expect(rect.y).toBeCloseTo(360, 3);
    expect(rect.y + rect.height).toBeCloseTo(440, 3);
  });

  it('works for A4, US Letter and a rotated page', () => {
    const r: Ratios = { ratioX: 0.1, ratioY: 0.2, ratioWidth: 0.3, ratioHeight: 0.05 };

    for (const page of [A4, LETTER, A4_LANDSCAPE]) {
      const rect = ratiosToPdfRect(r, page.widthPt, page.heightPt);

      expect(rect.x).toBeCloseTo(0.1 * page.widthPt, 6);
      expect(rect.width).toBeCloseTo(0.3 * page.widthPt, 6);
      expect(rect.height).toBeCloseTo(0.05 * page.heightPt, 6);
      // The top edge is 20% down the page, whatever the page's shape.
      expect(page.heightPt - (rect.y + rect.height)).toBeCloseTo(0.2 * page.heightPt, 6);
    }
  });
});

describe('fitPreservingAspect', () => {
  it('centres a wide image inside a tall box without stretching it', () => {
    const fitted = fitPreservingAspect({ x: 0, y: 0, width: 100, height: 100 }, 200, 100);

    expect(fitted.width).toBe(100);
    expect(fitted.height).toBe(50);
    expect(fitted.x).toBe(0);
    expect(fitted.y).toBe(25);
    expect(fitted.width / fitted.height).toBeCloseTo(200 / 100, 6);
  });

  it('centres a tall image inside a wide box', () => {
    const fitted = fitPreservingAspect({ x: 10, y: 20, width: 150, height: 40 }, 100, 200);

    expect(fitted.height).toBe(40);
    expect(fitted.width).toBe(20);
    expect(fitted.x).toBe(10 + (150 - 20) / 2);
    expect(fitted.y).toBe(20);
  });

  it('keeps the aspect ratio of a trimmed signature', () => {
    // sharp().trim() changes the ratio; drawing at the box size would stretch it.
    const box = { x: 0, y: 0, width: 150, height: 40 };
    const fitted = fitPreservingAspect(box, 640, 96);

    expect(fitted.width / fitted.height).toBeCloseTo(640 / 96, 6);
    expect(fitted.width).toBeLessThanOrEqual(box.width + 1e-9);
    expect(fitted.height).toBeLessThanOrEqual(box.height + 1e-9);
  });

  it('refuses an image with no size', () => {
    expect(() => fitPreservingAspect({ x: 0, y: 0, width: 10, height: 10 }, 0, 10)).toThrow(
      RangeError,
    );
  });
});

describe('validateRatios', () => {
  const valid: Ratios = { ratioX: 0.1, ratioY: 0.1, ratioWidth: 0.2, ratioHeight: 0.05 };

  it('accepts a field inside the page', () => {
    expect(validateRatios(valid)).toBeNull();
  });

  it('accepts the exact boundaries 0 and 1', () => {
    expect(validateRatios({ ratioX: 0, ratioY: 0, ratioWidth: 1, ratioHeight: 1 })).toBeNull();
  });

  it.each([
    ['negative x', { ...valid, ratioX: -0.001 }],
    ['x above 1', { ...valid, ratioX: 1.2 }],
    ['negative y', { ...valid, ratioY: -1 }],
    ['zero width', { ...valid, ratioWidth: 0 }],
    ['width above 1', { ...valid, ratioWidth: 1.5 }],
    ['not a number', { ...valid, ratioHeight: Number.NaN }],
  ])('rejects %s', (_name, r) => {
    expect(validateRatios(r)).toBe('RATIO_OUT_OF_RANGE');
  });

  it('rejects a field running off the right edge', () => {
    expect(validateRatios({ ...valid, ratioX: 0.9, ratioWidth: 0.2 })).toBe('FIELD_EXCEEDS_PAGE');
  });

  it('rejects a field running off the bottom edge', () => {
    expect(validateRatios({ ...valid, ratioY: 0.99, ratioHeight: 0.05 })).toBe(
      'FIELD_EXCEEDS_PAGE',
    );
  });

  it('tolerates rounding that pushes the sum a fraction over 1', () => {
    expect(
      validateRatios({ ratioX: 0.5, ratioY: 0, ratioWidth: 0.5000005, ratioHeight: 0.1 }),
    ).toBeNull();
  });
});

describe('snapToGrid', () => {
  it('rounds to the nearest 4pt', () => {
    expect(snapToGrid(0)).toBe(0);
    expect(snapToGrid(1.9)).toBe(0);
    expect(snapToGrid(2.1)).toBe(4);
    expect(snapToGrid(101)).toBe(100);
  });

  it('returns the value unchanged when snapping is switched off', () => {
    expect(snapToGrid(101.3, 0)).toBe(101.3);
  });
});

describe('clampRectToPage', () => {
  it('pulls a rectangle back inside the page, keeping its size', () => {
    const clamped = clampRectToPage({ x: 580, y: 830, width: 150, height: 40 }, A4);

    expect(clamped.width).toBe(150);
    expect(clamped.height).toBe(40);
    expect(clamped.x).toBeCloseTo(A4.widthPt - 150, 6);
    expect(clamped.y).toBeCloseTo(A4.heightPt - 40, 6);
  });

  it('pulls a rectangle back from negative coordinates', () => {
    const clamped = clampRectToPage({ x: -30, y: -10, width: 100, height: 20 }, A4);

    expect(clamped.x).toBe(0);
    expect(clamped.y).toBe(0);
  });

  it('shrinks a rectangle larger than the page', () => {
    const clamped = clampRectToPage({ x: 0, y: 0, width: 5000, height: 5000 }, A4);

    expect(clamped.width).toBe(A4.widthPt);
    expect(clamped.height).toBe(A4.heightPt);
  });

  it('produces ratios that always validate', () => {
    const clamped = clampRectToPage({ x: 900, y: 900, width: 200, height: 60 }, A4);

    expect(validateRatios(pointsToRatios(clamped, A4))).toBeNull();
  });
});

describe('enforceMinSize', () => {
  it('grows a tiny signature box to the minimum', () => {
    const grown = enforceMinSize({ x: 100, y: 100, width: 5, height: 2 }, 'SIGNATURE', A4);

    expect(grown.width).toBe(40);
    expect(grown.height).toBe(15);
    expect(grown.x).toBe(100);
  });

  it('keeps a checkbox square instead of forcing it to 40x15', () => {
    const grown = enforceMinSize({ x: 10, y: 10, width: 2, height: 2 }, 'CHECKBOX', A4);

    expect(grown.width).toBe(10);
    expect(grown.height).toBe(10);
  });

  it('grows away from the held corner when resizing from the bottom right', () => {
    const grown = enforceMinSize(
      { x: 100, y: 100, width: 10, height: 5 },
      'SIGNATURE',
      A4,
      'bottom-right',
    );

    // The bottom-right corner stays at (110, 105).
    expect(grown.x + grown.width).toBeCloseTo(110, 6);
    expect(grown.y + grown.height).toBeCloseTo(105, 6);
  });

  it('leaves a field that is already large enough alone', () => {
    const rect = { x: 50, y: 50, width: 150, height: 40 };

    expect(enforceMinSize(rect, 'SIGNATURE', A4)).toEqual(rect);
  });
});

describe('defaultRectAt', () => {
  it('centres a new signature field on the drop point and snaps it', () => {
    const rect = defaultRectAt('SIGNATURE', { xPt: 300, yPt: 400 }, A4);

    expect(rect.width).toBe(150);
    expect(rect.height).toBe(40);
    expect(rect.x % 4).toBe(0);
    expect(rect.x).toBeCloseTo(224, 6); // 300 - 75, snapped
  });

  it('keeps a field dropped at the page edge on the page', () => {
    const rect = defaultRectAt('SIGNATURE', { xPt: A4.widthPt, yPt: A4.heightPt }, A4);

    expect(validateRatios(pointsToRatios(rect, A4))).toBeNull();
  });
});

describe('findAlignmentGuides', () => {
  const other = { x: 100, y: 200, width: 150, height: 40 };

  it('finds a guide when the left edges line up', () => {
    const guides = findAlignmentGuides({ x: 101, y: 500, width: 150, height: 40 }, [other]);

    expect(guides).toContainEqual({ axis: 'x', positionPt: 100 });
  });

  it('finds a guide when a centre lines up with another centre', () => {
    const moving = { x: 300, y: 218, width: 150, height: 40 };
    const guides = findAlignmentGuides(moving, [other]);

    expect(guides.some((g) => g.axis === 'y' && Math.abs(g.positionPt - 220) < 1e-6)).toBe(true);
  });

  it('finds nothing when the fields are far apart', () => {
    expect(findAlignmentGuides({ x: 400, y: 600, width: 50, height: 20 }, [other])).toEqual([]);
  });

  it('reports each guide line once, however many fields share it', () => {
    const guides = findAlignmentGuides({ x: 100, y: 500, width: 150, height: 40 }, [
      other,
      { ...other, y: 300 },
      { ...other, y: 400 },
    ]);

    expect(guides.filter((g) => g.axis === 'x' && g.positionPt === 100)).toHaveLength(1);
  });
});

describe('roundRatio', () => {
  it('keeps six decimals', () => {
    expect(roundRatio(0.3359763149)).toBe(0.335976);
    expect(roundRatio(1 / 3)).toBe(0.333333);
  });

  it('makes two nearly equal placements compare exactly equal', () => {
    expect(roundRatio(0.1 + 0.2)).toBe(roundRatio(0.3));
  });
});

describe('rotated and cropped pages', () => {
  const a4 = { x: 0, y: 0, width: 595.28, height: 841.89 };
  const at = (rotation: PageGeometry['rotation'], box = a4): PageGeometry => ({
    visibleBox: box,
    rotation,
  });

  it('reads /Rotate as pdf.js does', () => {
    expect(normaliseRotation(0)).toBe(0);
    expect(normaliseRotation(-90)).toBe(270);
    expect(normaliseRotation(450)).toBe(90);
    expect(normaliseRotation(360)).toBe(0);
    expect(normaliseRotation(45)).toBe(0);
    expect(normaliseRotation(Number.NaN)).toBe(0);
  });

  it('shows the CropBox clipped to the MediaBox', () => {
    expect(visibleBox(a4, { x: 50, y: 60, width: 300, height: 400 })).toEqual({
      x: 50,
      y: 60,
      width: 300,
      height: 400,
    });
    // Reversed corners, and a CropBox reaching past the page.
    const clipped = visibleBox(a4, { x: 700, y: 900, width: -200, height: -100 });
    expect(clipped.x).toBe(500);
    expect(clipped.y).toBe(800);
    expect(clipped.width).toBeCloseTo(95.28, 9);
    expect(clipped.height).toBeCloseTo(41.89, 9);
    // No overlap at all: the whole page, as pdf.js does.
    expect(visibleBox(a4, { x: 1000, y: 1000, width: 10, height: 10 })).toEqual(a4);
  });

  it('swaps width and height only at 90 and 270 degrees', () => {
    expect(displayedPageSize(at(0))).toEqual({ widthPt: 595.28, heightPt: 841.89 });
    expect(displayedPageSize(at(90))).toEqual({ widthPt: 841.89, heightPt: 595.28 });
    expect(displayedPageSize(at(180))).toEqual({ widthPt: 595.28, heightPt: 841.89 });
    expect(displayedPageSize(at(270))).toEqual({ widthPt: 841.89, heightPt: 595.28 });
  });

  it('maps the displayed corners onto the right corners of the page', () => {
    // The viewer turns the page clockwise. At 90 degrees the page's own
    // bottom-left corner is shown at the top-left, its top-left at the
    // top-right, and its bottom-right at the bottom-left.
    const shown = displayedPageSize(at(90));
    expect(displayedPointToPdf({ x: 0, y: shown.heightPt }, at(90))).toEqual({ x: 0, y: 0 });
    expect(displayedPointToPdf({ x: shown.widthPt, y: shown.heightPt }, at(90))).toEqual({
      x: 0,
      y: 841.89,
    });
    expect(displayedPointToPdf({ x: 0, y: 0 }, at(90))).toEqual({ x: 595.28, y: 0 });

    // At 180 degrees the page is upside down; at 270 its bottom-left is shown
    // at the bottom-right.
    expect(displayedPointToPdf({ x: 0, y: 0 }, at(180))).toEqual({ x: 595.28, y: 841.89 });
    expect(displayedPointToPdf({ x: 841.89, y: 0 }, at(270))).toEqual({ x: 0, y: 0 });
  });

  it('adds the CropBox origin, so a cropped page is measured from what is shown', () => {
    const cropped = { x: 40, y: 30, width: 500, height: 700 };
    expect(displayedPointToPdf({ x: 0, y: 0 }, at(0, cropped))).toEqual({ x: 40, y: 30 });
    expect(displayedPointToPdf({ x: 10, y: 20 }, at(0, cropped))).toEqual({ x: 50, y: 50 });
  });

  it('round-trips every point at every angle', () => {
    const cropped = { x: 40, y: 30, width: 500, height: 700 };
    for (const rotation of [0, 90, 180, 270] as const) {
      for (const point of [
        { x: 0, y: 0 },
        { x: 123.4, y: 56.7 },
        { x: 480, y: 12 },
      ]) {
        const back = pdfPointToDisplayed(displayedPointToPdf(point, at(rotation, cropped)), {
          visibleBox: cropped,
          rotation,
        });
        expect(back.x).toBeCloseTo(point.x, 9);
        expect(back.y).toBeCloseTo(point.y, 9);
      }
    }
  });
});
