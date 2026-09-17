# Signing and Document Sealing

| | |
|---|---|
| **Status** | Draft for client review |
| **Version** | 1.0.0 |
| **Last updated** | 10 September 2026 |
| **Audience** | Everyone (Part 1) · Engineering (Part 2) |
| **What this doc answers** | How does a signature get onto the page in exactly the right place, and how is the document sealed? |

> **This is the most important technical document in this folder.** The product succeeds or fails on what is described here. Read Part 2 in full before writing any code that touches the PDF.

---

# PART 1 — In Plain Terms

## The Problem Nobody Expects

Here is the situation. Priya places a signature box on her laptop. Raj signs it on his phone. The signature must land on exactly the same physical spot on the actual document.

That sounds like it should be simple. It is not, for two reasons that compound each other.

### Reason one: every screen is different

A phone is roughly 390 units wide. A laptop is around 1,440. A large monitor might be 2,560. Someone might zoom to 200%, or turn a tablet sideways.

If Priya's laptop records *"the box is 620 units from the left"*, that measurement is meaningless on Raj's phone. His whole screen is narrower than that. The signature would land off the page entirely.

### Reason two: screens and documents count from opposite corners

This one is genuinely surprising, and it is where most naive implementations fail.

**A screen** starts counting from the **top-left** corner and measures **downward**. Something 100 units "down" is 100 units below the top edge.

**A PDF file** starts counting from the **bottom-left** corner and measures **upward**. Something 100 units "up" is 100 units above the bottom edge.

```
        A SCREEN                            A PDF FILE
                                       
   (0,0)                                            ▲
     ┌──────────────►                                │
     │                                               │
     │   ┌────────┐                       ┌────────┐ │
     │   │ signed │                       │ signed │ │
     │   └────────┘                       └────────┘ │
     │                                               │
     ▼                                (0,0) ─────────┴──►
     
   counts DOWN from the top          counts UP from the bottom
```

They are mirror images of each other. Feed a screen measurement straight into a PDF and every signature appears flipped to the opposite half of the page — a signature meant for the bottom of page 4 appears near the top.

This is the classic failure, it looks catastrophic to a client, and it is entirely avoidable.

## The Solution: Percentages

We never record positions in screen measurements at all.

Instead of *"620 units from the left"*, we record *"43% across."*

```
   ┌─────────────────────────────────────┐
   │                                     │
   │                                     │  ← 74% down from the top
   │            ┌──────────────┐         │
   │            │  Sign here   │         │
   │            └──────────────┘         │
   │            ↑                        │
   │            43% across from the left │
   └─────────────────────────────────────┘
```

A percentage means the same thing everywhere. 43% across an A4 page is the same physical spot whether you are looking at it on a phone, projecting it on a wall, or holding the printed sheet.

When the signature is finally placed into the real document, the system converts that percentage into the document's own measurements and flips it the right way up. One conversion, done in one place, correctly.

**This is the whole solution.** It is a simple idea. Its power comes entirely from applying it with discipline — the conversion happens in exactly one piece of code in the entire system. Scattered conversions drift apart over time, and drifting conversions are how signatures start landing in the wrong place months after launch.

## Baking the Signature In

Once the position is known, the signature has to become part of the document.

There are two ways to do this and only one of them is acceptable.

**The wrong way** is to attach the signature as a note or comment layered on top of the page. It looks identical on screen. But it is a separate object sitting above the document, and any PDF editor can remove it in one click without disturbing the page underneath. A signature that can be peeled off is not evidence of anything.

**The right way** — what we do — is to write the signature into the page content itself, the way ink soaks into paper. Once burned in, it is not a separate object any more. There is nothing to peel off. Removing it means editing the page, which changes the document's fingerprint, which is detectable.

## Sealing It

After the last person signs, four things happen:

**A certificate page is added to the back.** A plain, readable summary: who signed, when, from where, on what device, and the fingerprints at each stage. It travels with the document forever, so anyone opening the PDF sees the full story without needing access to our system.

**A final fingerprint is taken** of the completed file.

**The file is locked away** in storage that only opens one way. Once in, nobody can change or delete it — including us.

**Everyone gets an identical copy.**

### One curious detail worth understanding

You might reasonably ask: why not print the final fingerprint on the certificate page itself? It would be convenient.

It is impossible, and the reason is a neat little paradox.

The fingerprint is calculated from the entire file, certificate page included. The moment you print the fingerprint onto that page, you have changed the file — so the fingerprint is now wrong. Recalculate it, print the new one, and you have changed the file again. It never settles.

So the certificate page shows the fingerprint of each version *before* the certificate was added, and the final fingerprint is stored in our records and shown on the verification page and in the completion email. This is not a limitation of our system; it is a property of how fingerprints work, and every signature platform handles it the same way.

## How Anyone Can Check It Themselves

The verification story is short and it is the strongest thing about the product.

Anyone with a copy of the finished document can calculate its fingerprint using tools already installed on their computer — one command, a couple of seconds, no special software, no account, no permission from us.

If the result matches the fingerprint on record, the document is provably unaltered. If it does not match, someone changed something.

**Nobody has to trust us for this.** The technique is a public international standard. An opposing lawyer's own IT department can verify it independently and get the same answer. That independence is precisely what makes it worth something in a dispute.

---
---

# PART 2 — Technical Detail

> Written for engineering. Non-technical readers can stop here.

## Coordinate Systems

| | Browser / DOM | PDF native |
|---|---|---|
| Origin | Top-left | **Bottom-left** |
| Y direction | Increases downward | **Increases upward** |
| Unit | CSS pixels | Points (1pt = 1/72 inch) |
| Stability | Varies with zoom, DPR, viewport, CSS transforms | Fixed, absolute |
| A4 | Whatever it rendered at | 595.28 × 841.89 pt |
| US Letter | Whatever it rendered at | 612 × 792 pt |

## The Conversion

### Frontend: pixels → ratios (at placement)

```
   ratioX      = boxLeft   / renderedPageWidth
   ratioY      = boxTop    / renderedPageHeight
   ratioWidth  = boxWidth  / renderedPageWidth
   ratioHeight = boxHeight / renderedPageHeight
```

`renderedPageWidth/Height` MUST come from the PDF.js viewport for that page — `page.getViewport({ scale })` — not from `getBoundingClientRect()` on a wrapper element. Wrapper elements pick up padding, borders, and scrollbar width, and those errors are invisible in testing but consistently misplace fields by a few points.

### Backend: ratios → PDF points (at sealing)

```
   drawWidth  = ratioWidth  * pdfWidth
   drawHeight = ratioHeight * pdfHeight
   drawX      = ratioX      * pdfWidth
   drawY      = pdfHeight - (ratioY * pdfHeight) - drawHeight
                └──────────────────────────────┘   └────────┘
                  flip the origin to bottom-left    re-anchor from
                                                    top edge to bottom edge
```

**Why `drawHeight` is subtracted.** `ratioY` marks the box's *top* edge, measured downward. `pdf-lib`'s `drawImage` positions by the *bottom-left* corner. After flipping the origin you have the top edge's position in PDF space; subtracting the box height moves the anchor down to the bottom edge. Omit it and every field sits exactly one box-height too high — a subtle error that passes casual inspection on large fields and is glaring on small ones.

### The single chokepoint

```
   src/lib/coordinates.ts        ← the ONLY place these formulas exist
        │
        ├── src/components/FieldPlacementLayer.tsx   (browser: pixels → ratios)
        └── src/services/PdfSealingService.ts        (server:  ratios → points)
```

```typescript
// src/lib/coordinates.ts
// The single source of truth for coordinate conversion.
// Both browser and server import from here. Do not reimplement.

export interface Ratios {
  ratioX: number;
  ratioY: number;
  ratioWidth: number;
  ratioHeight: number;
}

export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Browser: rendered pixel box -> normalised ratios. */
export function pixelsToRatios(
  box: { left: number; top: number; width: number; height: number },
  renderedPageWidth: number,
  renderedPageHeight: number,
): Ratios {
  return {
    ratioX: box.left / renderedPageWidth,
    ratioY: box.top / renderedPageHeight,
    ratioWidth: box.width / renderedPageWidth,
    ratioHeight: box.height / renderedPageHeight,
  };
}

/** Server: normalised ratios -> PDF points, with Y-axis inversion. */
export function ratiosToPdfRect(
  r: Ratios,
  pdfWidth: number,
  pdfHeight: number,
): PdfRect {
  const width = r.ratioWidth * pdfWidth;
  const height = r.ratioHeight * pdfHeight;
  return {
    x: r.ratioX * pdfWidth,
    // Flip origin to bottom-left, then re-anchor from the box's top
    // edge to its bottom edge (pdf-lib positions by bottom-left).
    y: pdfHeight - r.ratioY * pdfHeight - height,
    width,
    height,
  };
}

/**
 * Fit an image inside a box while preserving its aspect ratio, centred.
 *
 * REQUIRED for signatures. sharp().trim() removes surrounding whitespace,
 * which changes the image's aspect ratio. Drawing the trimmed image at the
 * box's raw dimensions stretches the signature. See "Correction 1" below.
 */
export function fitPreservingAspect(
  box: PdfRect,
  imgWidth: number,
  imgHeight: number,
): PdfRect {
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
```

## Two Corrections to the Reference Specification

### Correction 1 — aspect-ratio distortion

**The bug.** `sharp().trim()` crops surrounding transparent space, changing the image's aspect ratio. The reference then draws it at the field box's exact `drawWidth` × `drawHeight`, stretching the signature to fill the box.

```
   Signature drawn by the user      After trim        Stretched to fill box
   ┌──────────────────────┐        ┌─────────┐       ┌──────────────────────┐
   │                      │        │ ~~~~~~  │       │                      │
   │      ~~~~~~          │   →    │ ~~~~~~  │  →    │  ~~~~~~~~~~~~~~~~~~  │
   │      ~~~~~~          │        └─────────┘       │  ~~~~~~~~~~~~~~~~~~  │
   │                      │        3:1 ratio         │                      │
   └──────────────────────┘                          └──────────────────────┘
   4:1 ratio                                          squashed to 4:1 — wrong
```

The distortion is subtle enough to survive review and obvious enough to embarrass you in front of a client.

**The fix.** Read the trimmed image's actual dimensions from `sharp().metadata()`, then scale to fit and centre using `fitPreservingAspect()`.

### Correction 2 — multi-signer version drift

**The bug.** A single `originalHash` / `finalHash` pair cannot describe a multi-signer chain. Signer 2 attests to a document that already carries signer 1's signature — a file whose hash appears nowhere in the record.

```
   Reference model:     original ────────────────────► final
                        (hashed)                       (hashed)
                                  ▲            ▲
                              signer 2     signer 3
                              saw THIS     saw THIS
                              — unrecorded, unprovable
```

In a dispute, that gap is the attack surface: *"my client never saw the version you are presenting."*

**The fix.** One `DocumentVersion` row per signing round, each with its own hash and the recipient who produced it.

```
   v0 ──signer 1──► v1 ──signer 2──► v2 ──signer 3──► v3 ──+cert──► sealed
   hash             hash             hash             hash          hash
                    ▲                ▲                ▲
                 signer 2         signer 3        what was
                 saw this         saw this        completed
```

Every signer's attested revision is now individually provable. Schema in [05-data-model.md](05-data-model.md).

### Correction 3 — the self-reference paradox

The final hash cannot be printed inside the document it hashes: writing it changes the bytes, invalidating it.

**Resolution:** the certificate page carries the per-version hashes (`v0`…`vN`), all of which are known before the certificate is written. The final sealed hash is computed after the certificate is appended, stored in `Envelope.finalHash`, and surfaced via the verification endpoint and completion email.

## `PdfSealingService`

```typescript
import { PDFDocument, rgb, StandardFonts, PDFFont } from 'pdf-lib';
import crypto from 'crypto';
import sharp from 'sharp';
import { ratiosToPdfRect, fitPreservingAspect } from '../lib/coordinates';

export interface FieldPlacement {
  pageNumber: number;          // 1-based
  ratioX: number;
  ratioY: number;
  ratioWidth: number;
  ratioHeight: number;
  type: 'SIGNATURE' | 'INITIALS' | 'DATE_SIGNED' | 'TEXT_INPUT' | 'CHECKBOX';
  value: string;               // base64 data URL for images; plain text otherwise
}

export interface AuditRecord {
  action: string;
  actorName: string;
  actorEmail: string;
  ipAddress: string;
  timestamp: string;           // ISO 8601, UTC
}

export interface VersionRecord {
  versionNumber: number;
  hash: string;
  signedBy: string | null;
  createdAt: string;
}

export interface SealResult {
  buffer: Buffer;
  hash: string;
}

export class PdfSealingService {
  /**
   * Burn one recipient's completed fields into the document, producing
   * the next version. Does NOT append the certificate — that happens
   * once, on the final version, via sealFinal().
   *
   * Idempotent per (envelopeId, versionNumber): the caller must key the
   * job so a worker retry cannot double-burn.
   */
  public async burnFields(
    sourcePdf: Buffer,
    fields: FieldPlacement[],
  ): Promise<SealResult> {
    const pdfDoc = await PDFDocument.load(sourcePdf);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    for (const field of fields) {
      const page = pdfDoc.getPage(field.pageNumber - 1);

      // getSize() reports the MediaBox. Pages carrying /Rotate 90 or 270
      // present transposed dimensions to the viewer, so swap before
      // converting. See "Gotchas" below.
      const raw = page.getSize();
      const rotation = page.getRotation().angle % 360;
      const swap = rotation === 90 || rotation === 270;
      const pdfWidth = swap ? raw.height : raw.width;
      const pdfHeight = swap ? raw.width : raw.height;

      const box = ratiosToPdfRect(field, pdfWidth, pdfHeight);

      switch (field.type) {
        case 'SIGNATURE':
        case 'INITIALS': {
          const base64 = field.value.replace(/^data:image\/\w+;base64,/, '');
          const raw = Buffer.from(base64, 'base64');

          // Trim surrounding transparency, then read the RESULTING
          // dimensions. Both steps are required: trimming alone changes
          // the aspect ratio, and drawing at the box's raw dimensions
          // would stretch the signature.
          const trimmed = await sharp(raw).trim().png().toBuffer();
          const meta = await sharp(trimmed).metadata();
          if (!meta.width || !meta.height) {
            throw new Error('Unable to read trimmed signature dimensions');
          }

          const fitted = fitPreservingAspect(box, meta.width, meta.height);
          const img = await pdfDoc.embedPng(trimmed);

          page.drawImage(img, {
            x: fitted.x,
            y: fitted.y,
            width: fitted.width,
            height: fitted.height,
          });
          break;
        }

        case 'DATE_SIGNED':
        case 'TEXT_INPUT': {
          const size = this.fitTextSize(field.value, box.width, box.height, font);
          page.drawText(field.value, {
            x: box.x,
            // Nudge up from the box's bottom edge so the glyph baseline
            // sits visually centred rather than resting on the border.
            y: box.y + box.height * 0.25,
            size,
            font,
            color: rgb(0.1, 0.1, 0.1),
          });
          break;
        }

        case 'CHECKBOX': {
          if (field.value === 'true') {
            const size = Math.min(box.width, box.height) * 0.8;
            page.drawText('X', {
              x: box.x + (box.width - size * 0.6) / 2,
              y: box.y + (box.height - size * 0.7) / 2,
              size,
              font,
              color: rgb(0.1, 0.1, 0.1),
            });
          }
          break;
        }
      }
    }

    const bytes = await pdfDoc.save();
    const buffer = Buffer.from(bytes);
    return { buffer, hash: this.fingerprint(buffer) };
  }

  /**
   * Append the Certificate of Completion and produce the final sealed
   * document. Called once, after the last recipient's fields are burned.
   */
  public async sealFinal(
    signedPdf: Buffer,
    envelopeId: string,
    versions: VersionRecord[],
    auditRecords: AuditRecord[],
  ): Promise<SealResult> {
    const pdfDoc = await PDFDocument.load(signedPdf);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    this.appendCertificate(pdfDoc, envelopeId, versions, auditRecords, font, bold);

    const bytes = await pdfDoc.save();
    const buffer = Buffer.from(bytes);

    // Computed AFTER the certificate is written. It cannot appear on the
    // certificate itself — writing it would change the bytes it describes.
    return { buffer, hash: this.fingerprint(buffer) };
  }

  public fingerprint(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /** Largest size that fits the text within the box, floored for legibility. */
  private fitTextSize(
    text: string,
    boxWidth: number,
    boxHeight: number,
    font: PDFFont,
  ): number {
    let size = Math.max(9, boxHeight * 0.6);
    while (size > 6 && font.widthOfTextAtSize(text, size) > boxWidth) {
      size -= 0.5;
    }
    return size;
  }

  private appendCertificate(
    pdfDoc: PDFDocument,
    envelopeId: string,
    versions: VersionRecord[],
    auditRecords: AuditRecord[],
    font: PDFFont,
    bold: PDFFont,
  ): void {
    let page = pdfDoc.addPage([612, 792]);   // US Letter
    const { width, height } = page.getSize();
    let y = height - 50;

    const newPageIfNeeded = (needed: number) => {
      if (y < needed) {
        page = pdfDoc.addPage([612, 792]);
        y = height - 50;
      }
    };

    // Header
    page.drawRectangle({
      x: 40, y: y - 35, width: width - 80, height: 45,
      color: rgb(0.95, 0.96, 0.98),
    });
    page.drawText('CERTIFICATE OF COMPLETION', {
      x: 55, y: y - 20, size: 14, font: bold, color: rgb(0.1, 0.15, 0.3),
    });
    y -= 60;

    page.drawText(`Envelope ID: ${envelopeId}`, { x: 50, y, size: 9, font: bold });
    y -= 14;
    page.drawText(`Completed: ${new Date().toISOString()} UTC`, { x: 50, y, size: 8, font });
    y -= 26;

    // Document chain of custody
    page.drawText('Document Chain of Custody', { x: 50, y, size: 10, font: bold });
    y -= 16;
    for (const v of versions) {
      newPageIfNeeded(80);
      const label = v.signedBy
        ? `v${v.versionNumber} — after ${v.signedBy}`
        : `v${v.versionNumber} — original document`;
      page.drawText(label, { x: 60, y, size: 8.5, font: bold, color: rgb(0.2, 0.2, 0.2) });
      y -= 11;
      page.drawText(`SHA-256: ${v.hash}`, { x: 60, y, size: 7, font, color: rgb(0.4, 0.4, 0.4) });
      y -= 16;
    }
    y -= 10;

    page.drawLine({
      start: { x: 50, y }, end: { x: width - 50, y },
      thickness: 1, color: rgb(0.85, 0.85, 0.85),
    });
    y -= 22;

    // Event history
    page.drawText('Event History', { x: 50, y, size: 10, font: bold });
    y -= 18;
    for (const r of auditRecords) {
      newPageIfNeeded(60);
      page.drawText(`${r.timestamp} UTC  —  ${r.action}`, {
        x: 60, y, size: 8.5, font: bold, color: rgb(0.2, 0.2, 0.2),
      });
      y -= 11;
      page.drawText(`${r.actorName} <${r.actorEmail}>   IP: ${r.ipAddress}`, {
        x: 60, y, size: 7.5, font, color: rgb(0.4, 0.4, 0.4),
      });
      y -= 17;
    }

    page.drawText(
      'This document is tamper-evident. Any alteration changes its SHA-256 fingerprint, ' +
      'which can be verified independently.',
      { x: 50, y: 35, size: 7, font, color: rgb(0.5, 0.5, 0.5) },
    );
  }
}
```

## Signature Capture

| Concern | Requirement |
|---|---|
| Resolution | Capture at 2–3× device pixel ratio. A 1× capture on a 390px phone yields a blurry image when scaled into a 612pt page. |
| Format | Transparent PNG. JPEG has no alpha channel and produces a white box over the document. |
| Smoothing | Variable-width Bézier (`signature_pad` default). Raw `lineTo` produces visibly jagged strokes. |
| Typed signatures | Render to canvas in an embedded script face, export identically to PNG, so both paths converge on one pipeline. |
| Payload size | Cap at ~500 KB. Signers on poor connections are the norm. |
| iOS Safari | `touch-action: none` on the canvas, and `preventDefault()` on `touchmove`, or the page scrolls while drawing. **Test on a real device.** |

## The Sealing Chain

```
   Upload             → hash → DocumentVersion 0 (original, never mutated)
   Recipient 1 signs  → burnFields()  → hash → DocumentVersion 1
   Recipient 2 signs  → burnFields()  → hash → DocumentVersion 2
   Last signer        → burnFields()  → hash → DocumentVersion N
                      → sealFinal()   → hash → Envelope.finalHash
                                             → completedFileUrl
                                             → S3 Object Lock applied
                                             → notify all parties
```

**Object Lock is applied to the final version only.** Intermediate versions must remain writable while the envelope is in flight. Locking them breaks multi-signer flows.

## Verification

`POST /v1/verify` accepts any PDF and answers:

1. Compute SHA-256 of the submitted bytes.
2. Look for a matching `Envelope.finalHash` or `DocumentVersion.hash`.
3. If matched → return the envelope's audit trail, signer list, and version chain.
4. If not matched → return `NOT_FOUND`, meaning *either* the document was never sealed here *or* it has been altered since. Do not guess between the two; report both possibilities honestly.

Independently, without the platform:

```bash
sha256sum completed-contract.pdf
# compare against the value on the verification page / completion email
```

That this works with a standard tool, offline, with no account, is the entire evidentiary value. Preserve it.

## Gotchas

| # | Issue | Handling |
|---|---|---|
| 1 | **Aspect-ratio distortion** | `fitPreservingAspect()` — Correction 1 |
| 2 | **Multi-signer version drift** | `DocumentVersion` per round — Correction 2 |
| 3 | **Rotated pages** (`/Rotate 90`, `270`) | `getSize()` returns MediaBox dimensions; the viewer sees them transposed. Swap width/height before converting. Handled in `burnFields()`. |
| 4 | **Non-uniform page sizes** | Read dimensions per page. Never assume the whole document is A4. |
| 5 | **Cropped pages** (`CropBox` ≠ `MediaBox`) | PDF.js renders the CropBox; `pdf-lib` positions against the MediaBox. Where they differ, offset by the CropBox origin. |
| 6 | **Scanned / image-only PDFs** | Signing works normally. Text extraction does not. Document the limitation. |
| 7 | **Encrypted PDFs** | `PDFDocument.load(bytes, { ignoreEncryption: true })` may still fail to save. Detect on upload and reject with a clear message. |
| 8 | **Existing AcroForm fields** | Flatten before burning, or form values may render inconsistently across viewers. |
| 9 | **Very large documents** | `pdf-lib` holds the document in memory. Enforce the 25 MB / 500 page cap; seal on workers, never in a request handler. |
| 10 | **The self-reference paradox** | Certificate carries per-version hashes; final hash lives in the database — Correction 3 |
| 11 | **Worker retry double-burn** | Key seal jobs on `(envelopeId, versionNumber)`; make version-row creation the atomic commit point. |
| 12 | **Wrapper-element measurement** | Take rendered dimensions from PDF.js `getViewport()`, never `getBoundingClientRect()` on a padded wrapper. |

## Testing Requirements

**Unit — `coordinates.ts`:**

- Round-trip: pixels → ratios → points, asserted against hand-computed expected values
- Y-inversion verified explicitly at top, middle, and bottom of the page
- A4 and US Letter
- Aspect-fit: wide image in tall box, tall image in wide box, exact match
- Boundary ratios: 0.0 and 1.0
- Rejection of ratios outside `[0.0, 1.0]`

**Integration — `PdfSealingService`:**

- Burn a known image at a known ratio; extract the page and assert pixel position within tolerance
- Rotated page (90°, 180°, 270°)
- Mixed page sizes in one document
- Multi-round burning produces a correct, contiguous version chain
- Certificate overflow across multiple pages with a long audit history

**End-to-end — Playwright, real devices:**

- Place a field on desktop, sign on **real iOS Safari**, verify placement in the output
- Same on **real Android Chrome**
- Place at 100% zoom, sign at 200% zoom — position must be identical
- Portrait placement, landscape signing

The cross-device placement tests are the highest-value tests in the suite. A signature landing in the wrong place is the worst failure this product can have, and it is the one most likely to reach production undetected.
