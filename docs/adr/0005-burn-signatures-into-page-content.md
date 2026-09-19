# 0005. Burn Signatures into Page Content, Not Annotations

**Status:** Accepted
**Date:** 2026-09-19
**Deciders:** Engineering

## Context

A signature can be added to a PDF in two ways:
- **As an annotation layered over the page.** This looks identical on screen, but any PDF editor
  can remove it in one click without touching the page underneath.
- **Written into the page's own content stream, like ink on paper.** Removing it then means editing
  the page, which changes the file's fingerprint.

Positions are stored as ratios of the page *as displayed*, with `/Rotate` and the CropBox applied
(ADR 0002). Doc 06's reference `burnFields` only swaps width and height on pages rotated by 90° or
270°. It then draws in the page's unrotated space, which is wrong except at one corner, and draws
the image sideways.

## Decision

- **Stamp into the page content** with `pdf-lib` `drawImage` and `drawText`, never as annotations.
  Any AcroForm is flattened before the first stamp, so form values render the same in every viewer.
- **Images** are trimmed of transparent edges and measured with `sharp`, then fitted with
  `fitPreservingAspect()`, keeping their proportions (Correction 1).
- **Text** is drawn in an embedded, subset Unicode font rather than a standard PDF font, which only
  encodes Windows-1252.
- **Rotation and CropBox (Correction 4).** A new function in `packages/shared/src/coordinates.ts`,
  the single place for coordinate arithmetic, maps a rectangle from the displayed page into the
  page's own space. It accounts for `/Rotate` 0, 90, 180 or 270 and the CropBox origin, and returns
  the angle to draw at. The image is then drawn turned with the page, so it reads upright on screen.
- **Tests read positions back** from the page content stream and check them to within 1 pt. They
  cover every rotation, mixed page sizes and an offset CropBox.

## Consequences

**Easier:**

- A stamped signature cannot be removed without changing the fingerprint.
- Placement is checked exactly, from the numbers written to the file, rather than by comparing
  rendered pixels.

**Harder:**

- `sharp` is a native dependency, installed per platform.
- Embedding a font makes each version bigger by the size of the subset.

**Accepted:**

- Characters outside the embedded font are drawn as `?` and logged. The stored value keeps the
  original text.
