import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  displayedPageSize,
  fitPreservingAspect,
  type PageRotation,
  pdfPointToDisplayed,
  type Ratios,
  ratiosToPdfRect,
} from '@envelope/shared';
import type { PinoLogger } from 'nestjs-pino';
import { degrees, PDFDocument, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { apply, placementsOnPage } from '../../test/helpers/pdf-placements';
import { PdfSealingService, pageGeometry, type StampField } from './pdf-sealing.service';

/** The builder's tolerance is 1 pt (docs/11, sprint 8 gate). The maths here is exact. */
const TOLERANCE_PT = 0.01;

const MIXED_PAGES = readFileSync(
  path.resolve(__dirname, '../../../web/e2e/fixtures/mixed-pages.pdf'),
);

function fakeLogger() {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  };
}

function sealing() {
  const logger = fakeLogger();
  return { logger, service: new PdfSealingService(logger as unknown as PinoLogger) };
}

/** A transparent PNG with ink of `inkWidth` x `inkHeight` in the middle of a wider canvas. */
async function paddedSignature(inkWidth = 200, inkHeight = 50): Promise<Buffer> {
  const ink = await sharp({
    create: { width: inkWidth, height: inkHeight, channels: 4, background: '#1e2a44ff' },
  })
    .png()
    .toBuffer();
  return sharp({
    create: {
      width: inkWidth * 2,
      height: inkHeight * 4,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: ink, left: inkWidth / 2, top: inkHeight * 1.5 }])
    .png()
    .toBuffer();
}

async function pdfWith(
  pages: { size: [number, number]; rotation?: number; crop?: [number, number, number, number] }[],
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const spec of pages) {
    const page = doc.addPage(spec.size);
    page.drawText('Test page', { x: 40, y: 40, size: 12, font });
    if (spec.rotation) page.setRotation(degrees(spec.rotation));
    if (spec.crop) page.setCropBox(...spec.crop);
  }
  return Buffer.from(await doc.save());
}

function field(overrides: Partial<StampField> & Ratios): StampField {
  return { id: 'f1', pageNumber: 1, type: 'SIGNATURE', value: 'signed', ...overrides };
}

/**
 * Reads the stamped image back and returns where its corners are shown on the
 * displayed page: bottom-left, bottom-right and top-left of the image as drawn.
 */
async function shownImageCorners(pdf: Buffer, pageNumber: number) {
  const { page, placements } = await placementsOnPage(pdf, pageNumber);
  const images = placements.filter((p) => p.kind === 'image');
  expect(images).toHaveLength(1);
  const matrix = images[0]?.matrix ?? [1, 0, 0, 1, 0, 0];
  const geometry = pageGeometry(page);
  const shown = (x: number, y: number) => pdfPointToDisplayed(apply(matrix, x, y), geometry);
  return { geometry, bottomLeft: shown(0, 0), bottomRight: shown(1, 0), topLeft: shown(0, 1) };
}

function expectNear(actual: { x: number; y: number }, expected: { x: number; y: number }) {
  expect(Math.abs(actual.x - expected.x)).toBeLessThan(TOLERANCE_PT);
  expect(Math.abs(actual.y - expected.y)).toBeLessThan(TOLERANCE_PT);
}

describe('PdfSealingService.burnFields', () => {
  const box: Ratios = { ratioX: 0.1, ratioY: 0.2, ratioWidth: 0.3, ratioHeight: 0.1 };

  it.each([0, 90, 180, 270] as PageRotation[])(
    'lands a signature in its box, upright, on a page turned %i degrees',
    async (rotation) => {
      const { service } = sealing();
      const source = await pdfWith([{ size: [595.28, 841.89], rotation }]);
      const result = await service.burnFields(source, [field(box)], {
        SIGNATURE: await paddedSignature(200, 50),
      });

      const { geometry, bottomLeft, bottomRight, topLeft } = await shownImageCorners(
        result.buffer,
        1,
      );
      const size = displayedPageSize(geometry);
      // The ink is 4:1 once trimmed; the padded canvas was 2:1.
      const expected = fitPreservingAspect(
        ratiosToPdfRect(box, size.widthPt, size.heightPt),
        200,
        50,
      );
      expectNear(bottomLeft, { x: expected.x, y: expected.y });
      expectNear(bottomRight, { x: expected.x + expected.width, y: expected.y });
      expectNear(topLeft, { x: expected.x, y: expected.y + expected.height });
    },
  );

  it('matches hand-worked numbers on an A4 page turned 90 degrees', async () => {
    const { service } = sealing();
    const source = await pdfWith([{ size: [595.28, 841.89], rotation: 90 }]);
    const result = await service.burnFields(source, [field(box)], {
      SIGNATURE: await paddedSignature(200, 50),
    });
    const { bottomLeft, bottomRight, topLeft } = await shownImageCorners(result.buffer, 1);

    // Shown 841.89 wide and 595.28 tall. The box: x 84.189, top 119.056 down,
    // 252.567 x 59.528, so its bottom edge is 416.696 up. A 4:1 image fills its
    // height: 238.112 x 59.528, centred, from x 91.4165.
    expectNear(bottomLeft, { x: 91.4165, y: 416.696 });
    expectNear(bottomRight, { x: 91.4165 + 238.112, y: 416.696 });
    expectNear(topLeft, { x: 91.4165, y: 416.696 + 59.528 });
  });

  it('measures each page on its own in a document of mixed sizes and angles', async () => {
    const { service } = sealing();
    const images = { SIGNATURE: await paddedSignature(300, 100) };
    const fields = [1, 2, 3].map((pageNumber) =>
      field({ ...box, id: `p${pageNumber}`, pageNumber }),
    );
    const result = await service.burnFields(MIXED_PAGES, fields, images);

    for (const pageNumber of [1, 2, 3]) {
      const { placements, page } = await placementsOnPage(result.buffer, pageNumber);
      const image = placements.find((p) => p.kind === 'image');
      if (!image) throw new Error(`no image on page ${pageNumber}`);
      const geometry = pageGeometry(page);
      const size = displayedPageSize(geometry);
      const expected = fitPreservingAspect(
        ratiosToPdfRect(box, size.widthPt, size.heightPt),
        300,
        100,
      );
      expectNear(pdfPointToDisplayed(apply(image.matrix, 0, 0), geometry), expected);
    }
  });

  it('measures from the CropBox, which is what the builder showed', async () => {
    const { service } = sealing();
    const source = await pdfWith([{ size: [612, 792], crop: [36, 48, 500, 700] }]);
    const result = await service.burnFields(source, [field(box)], {
      SIGNATURE: await paddedSignature(200, 50),
    });
    const { bottomLeft } = await shownImageCorners(result.buffer, 1);
    const expected = fitPreservingAspect(ratiosToPdfRect(box, 500, 700), 200, 50);
    expectNear(bottomLeft, expected);

    // And in the page's own coordinates, it sits 36 pt right and 48 pt up.
    const { placements } = await placementsOnPage(result.buffer, 1);
    const image = placements.find((p) => p.kind === 'image');
    const origin = apply(image?.matrix ?? [1, 0, 0, 1, 0, 0], 0, 0);
    expect(Math.abs(origin.x - (expected.x + 36))).toBeLessThan(TOLERANCE_PT);
    expect(Math.abs(origin.y - (expected.y + 48))).toBeLessThan(TOLERANCE_PT);
  });

  it('writes text on the box, reading left to right on a turned page', async () => {
    const { service } = sealing();
    const textBox: Ratios = { ratioX: 0.2, ratioY: 0.5, ratioWidth: 0.4, ratioHeight: 0.04 };
    for (const rotation of [0, 90, 270] as PageRotation[]) {
      const source = await pdfWith([{ size: [595.28, 841.89], rotation }]);
      const result = await service.burnFields(
        source,
        [field({ ...textBox, type: 'TEXT_INPUT', value: 'Acme Corporation' })],
        {},
      );
      const { page, placements } = await placementsOnPage(result.buffer, 1);
      // The last text on the page: the page's own label comes first.
      const text = placements.filter((p) => p.kind === 'text').at(-1);
      if (!text) throw new Error('no text drawn');
      const geometry = pageGeometry(page);
      const size = displayedPageSize(geometry);
      const rect = ratiosToPdfRect(textBox, size.widthPt, size.heightPt);
      const start = pdfPointToDisplayed(apply(text.matrix, 0, 0), geometry);
      const along = pdfPointToDisplayed(apply(text.matrix, 1, 0), geometry);

      expect(start.x).toBeGreaterThanOrEqual(rect.x);
      expect(start.x).toBeLessThan(rect.x + 3);
      expect(start.y).toBeGreaterThan(rect.y);
      expect(start.y).toBeLessThan(rect.y + rect.height);
      // The baseline runs left to right on the displayed page.
      expect(along.x).toBeGreaterThan(start.x);
      expect(Math.abs(along.y - start.y)).toBeLessThan(TOLERANCE_PT);
    }
  });

  it('draws a tick inside a ticked box and nothing for an unticked one', async () => {
    const { service } = sealing();
    const tickBox: Ratios = { ratioX: 0.5, ratioY: 0.5, ratioWidth: 0.03, ratioHeight: 0.02 };
    const source = await pdfWith([{ size: [595.28, 841.89], rotation: 90 }]);
    const result = await service.burnFields(
      source,
      [
        field({ ...tickBox, id: 'yes', type: 'CHECKBOX', value: 'true' }),
        field({ ...tickBox, id: 'no', ratioY: 0.7, type: 'CHECKBOX', value: 'false' }),
      ],
      {},
    );
    const { page, placements } = await placementsOnPage(result.buffer, 1);
    const lines = placements.filter((p) => p.kind === 'line');
    expect(lines).toHaveLength(2);
    const geometry = pageGeometry(page);
    const size = displayedPageSize(geometry);
    const rect = ratiosToPdfRect(tickBox, size.widthPt, size.heightPt);
    for (const line of lines) {
      for (const end of [line.from, line.to]) {
        if (!end) throw new Error('line without an end');
        const shown = pdfPointToDisplayed(end, geometry);
        expect(shown.x).toBeGreaterThan(rect.x);
        expect(shown.x).toBeLessThan(rect.x + rect.width);
        expect(shown.y).toBeGreaterThan(rect.y);
        expect(shown.y).toBeLessThan(rect.y + rect.height);
      }
    }
  });

  it('writes any Latin, Greek or Cyrillic name, and marks what the font lacks instead of failing', async () => {
    const { service, logger } = sealing();
    const source = await pdfWith([{ size: [595.28, 841.89] }]);
    const result = await service.burnFields(
      source,
      [
        field({
          ...box,
          id: 'name',
          type: 'TEXT_INPUT',
          value: 'Łucja Müller-Ødegård, Ελένη, Юрий',
        }),
        field({ ...box, id: 'hindi', ratioY: 0.5, type: 'TEXT_INPUT', value: 'नमस्ते Raj' }),
      ],
      {},
    );
    expect(result.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      { fieldId: 'hindi', replaced: 6 },
      'Characters the font cannot draw were replaced',
    );
    // What was written is never logged.
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('Raj');
  });

  it('skips empty fields, and refuses a signature box with no adopted image', async () => {
    const { service } = sealing();
    const source = await pdfWith([{ size: [595.28, 841.89] }]);
    const empty = await service.burnFields(
      source,
      [field({ ...box, value: null }), field({ ...box, type: 'TEXT_INPUT', value: null })],
      {},
    );
    const { placements } = await placementsOnPage(empty.buffer, 1);
    expect(placements.filter((p) => p.kind === 'image')).toHaveLength(0);

    await expect(service.burnFields(source, [field(box)], {})).rejects.toThrow(
      /No adopted signature/,
    );
    await expect(
      service.burnFields(source, [field({ ...box, pageNumber: 2 })], {
        SIGNATURE: await paddedSignature(),
      }),
    ).rejects.toThrow(/beyond the document/);
  });

  it('flattens a form before stamping', async () => {
    const { service } = sealing();
    const doc = await PDFDocument.create();
    const page = doc.addPage([595.28, 841.89]);
    const input = doc.getForm().createTextField('company');
    input.setText('Acme');
    input.addToPage(page, { x: 50, y: 700, width: 200, height: 20 });
    const source = Buffer.from(await doc.save());

    const result = await service.burnFields(source, [field(box)], {
      SIGNATURE: await paddedSignature(),
    });
    const stamped = await PDFDocument.load(result.buffer);
    expect(stamped.getForm().getFields()).toHaveLength(0);
  });

  it('gives the same bytes for the same inputs, so a retried seal writes the same file', async () => {
    const { service } = sealing();
    const source = await pdfWith([{ size: [595.28, 841.89], rotation: 90 }]);
    const images = { SIGNATURE: await paddedSignature() };
    const fields = [
      field(box),
      field({ ...box, id: 'date', ratioY: 0.4, type: 'DATE_SIGNED', value: '2026-09-19' }),
    ];
    const first = await service.burnFields(source, fields, images);
    const second = await service.burnFields(source, fields, images);
    expect(second.sha256).toBe(first.sha256);
    expect(first.sha256).toBe(service.fingerprint(first.buffer));
    expect(first.pageCount).toBe(1);
  });
});
