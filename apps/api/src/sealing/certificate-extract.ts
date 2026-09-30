import { PDFDocument } from 'pdf-lib';

/**
 * A new PDF made of the last `count` pages of `source`. The certificate is
 * appended after the signed pages when an envelope is sealed (docs/06), so it
 * is always the tail of the final version; no second copy is stored (docs/18,
 * workstream 11).
 */
export async function extractLastPages(source: Buffer, count: number): Promise<Buffer> {
  const input = await PDFDocument.load(source, { updateMetadata: false });
  const total = input.getPageCount();
  if (!Number.isInteger(count) || count < 1 || count > total) {
    throw new Error(`Cannot take ${count} pages from a ${total}-page document`);
  }
  const output = await PDFDocument.create({ updateMetadata: false });
  const pages = await output.copyPages(
    input,
    Array.from({ length: count }, (_, i) => total - count + i),
  );
  for (const page of pages) output.addPage(page);
  return Buffer.from(await output.save());
}
