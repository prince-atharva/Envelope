import { createHash } from 'node:crypto';
import {
  displayedPageSize,
  displayedPointToPdf,
  type FieldType,
  fitPreservingAspect,
  normaliseRotation,
  type PageGeometry,
  type PdfPoint,
  type Ratios,
  ratiosToPdfRect,
  visibleBox,
} from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import fontkit from '@pdf-lib/fontkit';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  degrees,
  LineCapStyle,
  PDFDocument,
  type PDFFont,
  type PDFImage,
  PDFName,
  type PDFPage,
  rgb,
} from 'pdf-lib';
import sharp from 'sharp';
import { fontBytes } from './fonts';

/** One field to write into the document, as stored (ratios of the displayed page). */
export interface StampField extends Ratios {
  id: string;
  /** 1-based, as stored. */
  pageNumber: number;
  type: FieldType;
  /**
   * TEXT_INPUT and DATE_SIGNED: the text. CHECKBOX: "true" or "false".
   * SIGNATURE and INITIALS: anything non-null means "stamp the adopted image".
   * Null: left empty, nothing is drawn.
   */
  value: string | null;
}

/** The recipient's adopted images, as PNG bytes. */
export type StampImages = Partial<Record<'SIGNATURE' | 'INITIALS', Buffer>>;

export interface StampResult {
  buffer: Buffer;
  sha256: string;
  pageCount: number;
}

const INK = rgb(0.1, 0.1, 0.1);
const MIN_TEXT_PT = 6;
const MAX_TEXT_PT = 16;

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function elapsed(started: number): number {
  return Math.round(performance.now() - started);
}

/** Where a page is shown from and how it is turned: what the stored ratios are relative to. */
export function pageGeometry(page: PDFPage): PageGeometry {
  return {
    visibleBox: visibleBox(page.getMediaBox(), page.getCropBox()),
    rotation: normaliseRotation(page.getRotation().angle),
  };
}

/**
 * Writes signatures and answers into the page content itself (ADR 0005), never
 * as annotations that a PDF editor could lift off.
 *
 * Every position goes through `@envelope/shared` coordinates: ratios -> the
 * displayed page -> the page's own space, turned with the page (docs/15,
 * Correction 4). Nothing here does its own coordinate arithmetic.
 */
@Injectable()
export class PdfSealingService {
  constructor(@InjectPinoLogger(PdfSealingService.name) private readonly logger: PinoLogger) {}

  fingerprint(buffer: Buffer): string {
    return sha256(buffer);
  }

  /**
   * One recipient's fields, stamped into `source` to make the next version
   * (ADR 0003). Deterministic: the same inputs give the same bytes, so a retried
   * seal job writes exactly what the first attempt wrote.
   */
  async burnFields(
    source: Buffer,
    fields: readonly StampField[],
    images: StampImages,
  ): Promise<StampResult> {
    const started = performance.now();
    // No new producer or modification date: the output depends on the inputs only.
    const pdf = await PDFDocument.load(source, { updateMetadata: false });
    this.flattenForm(pdf);

    const stamper = new Stamper(pdf, this.logger);
    for (const field of fields) {
      if (field.value === null) continue;
      if (field.pageNumber < 1 || field.pageNumber > pdf.getPageCount()) {
        throw new Error(`Field ${field.id} is on page ${field.pageNumber}, beyond the document`);
      }
      const page = pdf.getPage(field.pageNumber - 1);
      switch (field.type) {
        case 'SIGNATURE':
        case 'INITIALS': {
          const image = images[field.type];
          if (!image) {
            throw new Error(`No adopted ${field.type.toLowerCase()} for field ${field.id}`);
          }
          await stamper.image(page, field, field.type, image);
          break;
        }
        case 'TEXT_INPUT':
        case 'DATE_SIGNED':
          await stamper.text(page, field, field.value);
          break;
        case 'CHECKBOX':
          if (field.value === 'true') stamper.tick(page, field);
          break;
      }
    }

    const buffer = Buffer.from(await pdf.save());
    const result = { buffer, sha256: sha256(buffer), pageCount: pdf.getPageCount() };
    this.logger.info(
      {
        fields: fields.length,
        stamped: stamper.count,
        bytesIn: source.length,
        bytesOut: buffer.length,
        durationMs: elapsed(started),
      },
      'Fields stamped',
    );
    return result;
  }

  /**
   * Form fields are drawn by each viewer from their own settings, so values can
   * look different from one viewer to the next. Flattening turns them into page
   * content before anything is stamped (docs/06, gotcha 8). The upload
   * sanitiser removes XFA, but an ordinary AcroForm survives it.
   */
  private flattenForm(pdf: PDFDocument): void {
    if (!pdf.catalog.has(PDFName.of('AcroForm'))) return;
    const form = pdf.getForm();
    const count = form.getFields().length;
    if (count === 0) return;
    try {
      form.flatten();
      this.logger.info({ formFields: count }, 'Form flattened before stamping');
    } catch (error) {
      // The stamp itself does not depend on it; the document is still sealed.
      this.logger.warn({ err: error, formFields: count }, 'Form could not be flattened');
    }
  }
}

/** Draws into one document, embedding each font and image once. */
class Stamper {
  count = 0;
  private font?: PDFFont;
  private supported?: Set<number>;
  private readonly embedded = new Map<string, { image: PDFImage; width: number; height: number }>();

  constructor(
    private readonly pdf: PDFDocument,
    private readonly logger: PinoLogger,
  ) {}

  /** The box on the displayed page, in points with the origin at its bottom-left. */
  private box(page: PDFPage, field: StampField) {
    const geometry = pageGeometry(page);
    const size = displayedPageSize(geometry);
    return { geometry, rect: ratiosToPdfRect(field, size.widthPt, size.heightPt) };
  }

  private at(point: PdfPoint, geometry: PageGeometry): PdfPoint {
    return displayedPointToPdf(point, geometry);
  }

  async image(page: PDFPage, field: StampField, kind: string, png: Buffer): Promise<void> {
    let embedded = this.embedded.get(kind);
    if (!embedded) {
      const trimmed = await trimToInk(png);
      embedded = { image: await this.pdf.embedPng(trimmed.png), ...trimmed };
      this.embedded.set(kind, embedded);
    }
    const { geometry, rect } = this.box(page, field);
    // Kept in proportion and centred (docs/06, Correction 1).
    const fitted = fitPreservingAspect(rect, embedded.width, embedded.height);
    const anchor = this.at({ x: fitted.x, y: fitted.y }, geometry);
    page.drawImage(embedded.image, {
      x: anchor.x,
      y: anchor.y,
      width: fitted.width,
      height: fitted.height,
      rotate: degrees(geometry.rotation),
    });
    this.count += 1;
  }

  async text(page: PDFPage, field: StampField, value: string): Promise<void> {
    const font = await this.embedFont();
    const text = this.drawable(value, field.id);
    if (text.length === 0) return;
    const { geometry, rect } = this.box(page, field);

    const padding = Math.min(2, rect.width * 0.05);
    const room = rect.width - padding * 2;
    let size = Math.max(MIN_TEXT_PT, Math.min(MAX_TEXT_PT, rect.height * 0.7));
    while (size > MIN_TEXT_PT && font.widthOfTextAtSize(text, size) > room) {
      size = Math.max(MIN_TEXT_PT, size - 0.5);
    }
    if (font.widthOfTextAtSize(text, size) > room) {
      // Drawn in full rather than cut: the page shows what the signer entered.
      this.logger.warn({ fieldId: field.id, sizePt: size }, 'Text is wider than its box');
    }
    // Centre the letters' height (ascent, no descender) in the box.
    const ascent = font.heightAtSize(size, { descender: false });
    const baseline = rect.y + (rect.height - ascent) / 2;
    const anchor = this.at({ x: rect.x + padding, y: baseline }, geometry);
    page.drawText(text, {
      x: anchor.x,
      y: anchor.y,
      size,
      font,
      color: INK,
      rotate: degrees(geometry.rotation),
    });
    this.count += 1;
  }

  /** A drawn tick. Each end point is mapped on its own, so rotation needs nothing more. */
  tick(page: PDFPage, field: StampField): void {
    const { geometry, rect } = this.box(page, field);
    const point = (fx: number, fy: number) =>
      this.at({ x: rect.x + rect.width * fx, y: rect.y + rect.height * fy }, geometry);
    const thickness = Math.max(0.75, Math.min(rect.width, rect.height) * 0.12);
    const style = { thickness, color: INK, lineCap: LineCapStyle.Round };
    const [start, bend, end] = [point(0.2, 0.52), point(0.42, 0.25), point(0.82, 0.8)];
    page.drawLine({ start, end: bend, ...style });
    page.drawLine({ start: bend, end, ...style });
    this.count += 1;
  }

  private async embedFont(): Promise<PDFFont> {
    if (!this.font) {
      this.pdf.registerFontkit(fontkit);
      this.font = await this.pdf.embedFont(fontBytes('regular'), { subset: true });
      this.supported = new Set(this.font.getCharacterSet());
    }
    return this.font;
  }

  /**
   * The text with anything the font cannot draw replaced by "?", so a stray
   * character never fails the whole seal. The stored value keeps the original.
   * Only the count is logged, never the text.
   */
  private drawable(value: string, fieldId: string): string {
    const supported = this.supported ?? new Set<number>();
    let replaced = 0;
    const text = Array.from(value.replace(/[\r\n\t]+/g, ' '))
      .map((char) => {
        const code = char.codePointAt(0) ?? 0;
        if (supported.has(code)) return char;
        replaced += 1;
        return '?';
      })
      .join('')
      .trim();
    if (replaced > 0) {
      this.logger.warn({ fieldId, replaced }, 'Characters the font cannot draw were replaced');
    }
    return text;
  }
}

/**
 * Removes the transparent margin around a signature and reports the size that
 * is left, which the stamp then keeps in proportion (docs/06, Correction 1).
 * The browser crops too, but the server does not rely on it.
 */
async function trimToInk(png: Buffer): Promise<{ png: Buffer; width: number; height: number }> {
  let trimmed: Buffer;
  try {
    trimmed = await sharp(png).trim({ threshold: 0 }).png().toBuffer();
  } catch {
    // Nothing to trim (a blank image): keep it as it is.
    trimmed = await sharp(png).png().toBuffer();
  }
  const { width, height } = await sharp(trimmed).metadata();
  if (!width || !height) throw new Error('Unable to read the signature image size');
  return { png: trimmed, width, height };
}
