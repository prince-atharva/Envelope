import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  type PDFObject,
  PDFRef,
  PDFStream,
  PDFString,
  StandardFonts,
} from 'pdf-lib';

/** An ordinary A4 PDF with a line of text on each page. */
export async function makePdf(pages = 1, label = 'Consent form'): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let number = 1; number <= pages; number += 1) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(`${label}: page ${number} of ${pages}`, { x: 72, y: 760, size: 18, font });
  }
  return Buffer.from(await doc.save());
}

/** Many empty pages, cheaply (for the page limit). */
export async function makeBlankPdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let number = 0; number < pages; number += 1) doc.addPage([200, 200]);
  return Buffer.from(await doc.save());
}

/** A PDF whose trailer declares encryption, which is all a reader checks first. */
export async function makeEncryptedPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage();
  const encrypt = doc.context.obj({
    Filter: 'Standard',
    V: 2,
    R: 3,
    Length: 128,
    P: -44,
    O: PDFString.of('o'.repeat(32)),
    U: PDFString.of('u'.repeat(32)),
  });
  doc.context.trailerInfo.Encrypt = doc.context.register(encrypt);
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

export const SAFE_LINK = 'https://healthprohub.example/help';

/**
 * A PDF carrying every kind of active content the sanitiser removes, plus one
 * ordinary web link that must survive.
 */
export async function makeActivePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const ctx = doc.context;
  const script = (code: string) => ctx.obj({ S: 'JavaScript', JS: PDFString.of(code) });

  doc.addJavaScript('on-open', 'app.alert("document script")');
  doc.catalog.set(
    PDFName.of('OpenAction'),
    ctx.obj({ Type: 'Action', S: 'Launch', F: PDFString.of('calc.exe') }),
  );
  page.node.set(PDFName.of('AA'), ctx.obj({ O: script('app.alert("page open")') }));

  const scriptLink = ctx.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [0, 0, 100, 20],
    A: script('app.alert("link")'),
  });
  const webLink = ctx.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [0, 30, 100, 50],
    A: ctx.obj({ S: 'URI', URI: PDFString.of(SAFE_LINK) }),
  });
  page.node.set(PDFName.of('Annots'), ctx.obj([ctx.register(scriptLink), ctx.register(webLink)]));

  await doc.attach(Buffer.from('hidden attachment'), 'notes.txt', { mimeType: 'text/plain' });
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

const RISKY_ACTIONS = new Set(['JavaScript', 'Launch', 'SubmitForm', 'ImportData', 'GoToR']);

/**
 * Independent inspection (not the code under test): parses a PDF and lists any
 * active content still present, plus every web link found.
 */
export async function inspectPdf(bytes: Buffer): Promise<{ findings: string[]; links: string[] }> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const findings = new Set<string>();
  const links: string[] = [];
  const seen = new Set<PDFDict>();

  const visit = (value: PDFObject | undefined): void => {
    if (value instanceof PDFRef) return; // indirect objects are visited from the top-level loop
    if (value instanceof PDFStream) {
      visit(value.dict);
      return;
    }
    if (value instanceof PDFArray) {
      for (const item of value.asArray()) visit(item);
      return;
    }
    if (!(value instanceof PDFDict) || seen.has(value)) return;
    seen.add(value);
    for (const [key, child] of value.entries()) {
      const name = key.decodeText();
      if (['JS', 'JavaScript', 'EmbeddedFiles', 'EF', 'AA', 'XFA'].includes(name)) {
        findings.add(`/${name}`);
      }
      if (name === 'S' && child instanceof PDFName && RISKY_ACTIONS.has(child.decodeText())) {
        findings.add(`/S /${child.decodeText()}`);
      }
      if (name === 'URI' && child instanceof PDFString) links.push(child.decodeText());
      visit(child);
    }
  };

  for (const [, object] of doc.context.enumerateIndirectObjects()) visit(object);
  return { findings: [...findings].sort(), links };
}
