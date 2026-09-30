import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { makePdf } from '../../test/fixtures/pdfs';
import { pdfPageTexts } from '../../test/helpers/pdf-text';
import { extractLastPages } from './certificate-extract';

describe('extractLastPages', () => {
  it('keeps only the tail of the document, in order', async () => {
    const source = await makePdf(5);
    const cut = await PDFDocument.load(await extractLastPages(source, 2));
    expect(cut.getPageCount()).toBe(2);
    const texts = await pdfPageTexts(await extractLastPages(source, 2));
    expect(texts[0]).toContain('page 4 of 5');
    expect(texts[1]).toContain('page 5 of 5');
  });

  it('can take every page', async () => {
    const cut = await PDFDocument.load(await extractLastPages(await makePdf(3), 3));
    expect(cut.getPageCount()).toBe(3);
  });

  it('refuses a count the document cannot satisfy', async () => {
    const source = await makePdf(2);
    await expect(extractLastPages(source, 0)).rejects.toThrow('Cannot take 0 pages');
    await expect(extractLastPages(source, 3)).rejects.toThrow('Cannot take 3 pages');
    await expect(extractLastPages(source, 1.5)).rejects.toThrow('Cannot take');
  });

  it('gives the same bytes for the same input', async () => {
    const source = await makePdf(4);
    const a = await extractLastPages(source, 2);
    const b = await extractLastPages(source, 2);
    expect(a.equals(b)).toBe(true);
  });
});
