import {
  decodePDFRawStream,
  PDFArray,
  PDFDocument,
  type PDFPage,
  PDFRawStream,
  type PDFRef,
} from 'pdf-lib';

/** A PDF transformation matrix [a b c d e f]. */
export type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m1 then m2 (the PDF convention: a `cm` operand is applied before the current matrix). */
export function multiply(m1: Matrix, m2: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    e1 * a2 + f1 * c2 + e2,
    e1 * b2 + f1 * d2 + f2,
  ];
}

export function apply(m: Matrix, x: number, y: number): { x: number; y: number } {
  const [a, b, c, d, e, f] = m;
  return { x: a * x + c * y + e, y: b * x + d * y + f };
}

export interface Placement {
  kind: 'image' | 'text' | 'line';
  /** Images: the matrix mapping the unit square. Text: the text matrix times the CTM. */
  matrix: Matrix;
  /** Lines: the two end points, in the page's own coordinates. */
  from?: { x: number; y: number };
  to?: { x: number; y: number };
}

function contentBytes(page: PDFPage): Buffer {
  const contents = page.node.Contents();
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((ref) => page.doc.context.lookup(ref as PDFRef))
      : [contents];
  return Buffer.concat(
    streams.map((stream) =>
      stream instanceof PDFRawStream
        ? Buffer.from(decodePDFRawStream(stream).decode())
        : Buffer.alloc(0),
    ),
  );
}

/** Numbers, names and operators; strings and arrays are skipped as single tokens. */
function tokens(content: string): string[] {
  return (
    content.match(
      /<[0-9A-Fa-f\s]*>|\((?:\\.|[^\\)])*\)|\[[^\]]*\]|\/[^\s/<>[\]()]+|[^\s/<>[\]()]+/g,
    ) ?? []
  );
}

/**
 * Every image drawn, text shown and line stroked on a page, with the matrix or
 * points that place it, read from the content stream as a viewer would.
 * Enough of the PDF operator set for what pdf-lib writes when stamping.
 */
export function placementsOn(page: PDFPage): Placement[] {
  const found: Placement[] = [];
  const stack: Matrix[] = [];
  let ctm: Matrix = IDENTITY;
  let textMatrix: Matrix = IDENTITY;
  let pathStart: { x: number; y: number } | undefined;
  const operands: string[] = [];
  const nums = (count: number) => operands.slice(-count).map(Number);

  for (const token of tokens(contentBytes(page).toString('latin1'))) {
    if (/^[-+.\d]/.test(token) || token.startsWith('/') || /^[<([]/.test(token)) {
      operands.push(token);
      continue;
    }
    switch (token) {
      case 'q':
        stack.push(ctm);
        break;
      case 'Q':
        ctm = stack.pop() ?? IDENTITY;
        break;
      case 'cm':
        ctm = multiply(nums(6) as Matrix, ctm);
        break;
      case 'BT':
        textMatrix = IDENTITY;
        break;
      case 'Tm':
        textMatrix = nums(6) as Matrix;
        break;
      case 'Td': {
        const [tx = 0, ty = 0] = nums(2);
        textMatrix = multiply([1, 0, 0, 1, tx, ty], textMatrix);
        break;
      }
      case 'Tj':
      case 'TJ':
        found.push({ kind: 'text', matrix: multiply(textMatrix, ctm) });
        break;
      case 'Do':
        found.push({ kind: 'image', matrix: ctm });
        break;
      case 'm': {
        const [x = 0, y = 0] = nums(2);
        pathStart = apply(ctm, x, y);
        break;
      }
      case 'l': {
        const [x = 0, y = 0] = nums(2);
        const to = apply(ctm, x, y);
        if (pathStart) found.push({ kind: 'line', matrix: ctm, from: pathStart, to });
        pathStart = to;
        break;
      }
    }
    operands.length = 0;
  }
  return found;
}

/** Loads a PDF and returns the placements on one page (1-based). */
export async function placementsOnPage(pdf: Buffer, pageNumber: number) {
  const doc = await PDFDocument.load(pdf);
  const page = doc.getPage(pageNumber - 1);
  return { page, placements: placementsOn(page) };
}
