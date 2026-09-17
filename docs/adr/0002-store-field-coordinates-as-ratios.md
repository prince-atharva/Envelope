# 0002. Store Field Coordinates as Normalised Ratios

**Status:** Accepted
**Date:** 2026-09-17
**Deciders:** Engineering

## Context

A signature field is placed by dragging a box onto a page on screen, and is later burned into the
PDF on a server that never sees that screen. Between those two moments, nothing about the page's
size is stable:

- The browser renders the page at whatever width fits, multiplied by a zoom level the user chooses
  and a device pixel ratio the device chooses.
- The PDF itself measures in points, 1/72 inch: A4 is 595.28 × 841.89, US Letter is 612 × 792, and
  one document may mix both.
- The browser's origin is the top-left corner with Y growing downward. The PDF's origin is the
  **bottom-left** corner with Y growing upward.

Storing what the browser measured, in pixels, is the obvious approach. It works perfectly on the
machine that placed the field and fails everywhere else: the signature lands in a different physical
spot on a laptop, a phone and a printout. Doc 11 rates this the highest-severity failure in the
product, because it destroys confidence instantly and may not surface until a real contract is
signed.

Ratios are not enough on their own. If the browser rounds pixel measurements at each zoom level, a
field placed at 100% and the same field placed at 200% produce ratios that differ in the tenth
decimal place. Those differences are invisible on screen, they break the equality test that proves
zoom independence, and they accumulate through repeated edits.

## Decision

We will store field geometry **only** as four ratios — `ratioX`, `ratioY`, `ratioWidth` and
`ratioHeight` — and never as pixels or points.

- **Range:** each ratio is in `[0, 1]`, with `ratioX + ratioWidth <= 1` and
  `ratioY + ratioHeight <= 1`. Both the database (a CHECK constraint, with a 1e-6 tolerance for
  floating-point arithmetic) and the API enforce this. The API validates the exact range.
- **Origin:** the top-left corner of the page, with Y growing downward, matching the browser. The
  server inverts Y when it converts to PDF points.
- **Reference page:** the **displayed** page, meaning the pdf.js viewport at scale 1, which already
  applies `/Rotate` and the CropBox. A page rotated 90° is therefore measured in its rotated,
  landscape shape, which is what the user saw when placing the field.
- **Precision:** ratios are rounded to **6 decimal places**. On an A4 page that is 0.0008pt, far
  below the 1pt tolerance the product promises, and it makes the stored value stable and comparable
  with `===`.
- **Interaction space:** the builder converts ratios to **points** once, does all of its geometry in
  points (dragging, snapping to the 4pt grid, alignment guides, minimum sizes, keyboard nudging),
  and converts back. Zoom only affects the pixels-to-points divisor, so a snapped position is
  identical at every zoom level.
- **One module:** every conversion lives in `packages/shared/src/coordinates.ts`, imported by both
  the browser and the server. No component, service or test may do this arithmetic itself.

## Consequences

**Easier:**

- A field lands in the same physical place on every device, at every zoom, and in print.
- Mixed page sizes and rotated pages need no special cases in the UI: each page converts with its
  own dimensions.
- The correctness of the whole feature can be tested in one small, pure unit-test file, without a
  browser.
- The zoom-independence test becomes a plain equality check.

**Harder:**

- Ratios are unreadable while debugging. `0.412500` means nothing until it is multiplied by a page
  size, so tools and log lines have to convert before showing anything.
- Every interaction needs two conversions, and the code has to be disciplined about which space a
  variable is in. Names carry the unit: `xPt`, `cssWidth`, `ratioX`.
- A field's size is relative to the page, so the same field on a Letter page and an A4 page is not
  the same number of points. Minimum sizes are therefore checked in points, not ratios.

**Accepted:**

- Rounding to 6 decimals can move a box by up to 0.0004pt. That is invisible and well inside the
  1pt tolerance.
- Ratios cannot express a rotated field — a signature at 45° on an upright page. The field model has
  no rotation, and adding one later means a new column, not a change to this decision.
- If a document is ever replaced by a different version of itself, the ratios stay valid but the
  content underneath may move. Guarding against that is the version chain's job
  (ADR 0003, planned), not this one's.
