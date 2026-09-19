import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * The text of each page, as a PDF reader extracts it. The certificate is drawn
 * in an embedded subset font, so this goes through pdf.js, which reads the
 * font's ToUnicode map as any viewer would.
 */
export async function pdfPageTexts(pdf: Buffer): Promise<string[]> {
  const task = getDocument({ data: new Uint8Array(pdf), useSystemFonts: false });
  const document = await task.promise;
  try {
    const pages: string[] = [];
    for (let n = 1; n <= document.numPages; n += 1) {
      const page = await document.getPage(n);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join('\n'));
    }
    return pages;
  } finally {
    await task.destroy();
  }
}
