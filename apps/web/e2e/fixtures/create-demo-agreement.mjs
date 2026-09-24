import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(dir, '../../../../apps/api');
const require = createRequire(join(apiDir, 'package.json'));
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

/**
 * A plausible-looking agreement for the UI gallery.
 *
 * The other fixtures say "Test Document — Page 1 of 12" on every page, which is
 * exactly right for asserting on page numbers and wrong for judging how a
 * screen looks: every screenshot's document pane reads as a test artefact. This
 * one has headed paper, real paragraphs and a signature block, so the chrome
 * can be reviewed against something that resembles what a sender would upload.
 */

const A4 = [595.28, 841.89];
const MARGIN = 56;
const INK = rgb(0.09, 0.11, 0.15);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.85, 0.87, 0.89);
const BRAND = rgb(0.06, 0.46, 0.43);

const SECTIONS = [
  {
    heading: '1. Services',
    body: [
      'The Provider agrees to deliver the outpatient services described in Schedule A to the',
      'Patient, at the times and locations agreed between the parties. Services are delivered by',
      'registered practitioners holding current professional indemnity cover.',
      'Any change to the scope of services requires the written agreement of both parties.',
    ],
  },
  {
    heading: '2. Fees and payment',
    body: [
      'Fees are set out in Schedule B and are payable within thirty (30) days of the invoice date.',
      'Where a third-party insurer is responsible for settlement, the Patient remains liable for any',
      'amount the insurer declines to cover.',
      'The Provider will give sixty (60) days written notice before any change to the fee schedule.',
    ],
  },
  {
    heading: '3. Consent to treatment',
    body: [
      'The Patient confirms that the nature, benefits and material risks of the proposed treatment',
      'have been explained, and that they have had the opportunity to ask questions.',
      'Consent may be withdrawn at any time, in writing, without affecting the Patient’s right to',
      'continued care.',
    ],
  },
  {
    heading: '4. Confidentiality and records',
    body: [
      'The Provider holds clinical records in accordance with applicable data-protection law and',
      'its published retention schedule. Records are disclosed only where the Patient consents, or',
      'where disclosure is required by law or necessary to prevent serious harm.',
      'The Patient may request a copy of their records at any time.',
    ],
  },
  {
    heading: '5. Cancellation',
    body: [
      'Either party may cancel a scheduled appointment by giving at least twenty-four (24) hours',
      'notice. Appointments cancelled with less notice, or missed without notice, may be charged',
      'at the rate set out in Schedule B.',
    ],
  },
  {
    heading: '6. Term and termination',
    body: [
      'This agreement takes effect on the date of the last signature below and continues until',
      'terminated by either party on thirty (30) (days) written notice.',
      'Termination does not affect any right or obligation accrued before the termination date.',
      'Clauses 4 and 7 survive termination.',
    ],
  },
];

async function main() {
  const doc = await PDFDocument.create();
  const body = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const total = 6;

  const newPage = (index) => {
    const page = doc.addPage(A4);
    const { width, height } = page.getSize();

    // Headed paper.
    page.drawText('HealthProHub', {
      x: MARGIN,
      y: height - MARGIN,
      size: 13,
      font: bold,
      color: BRAND,
    });
    page.drawText('Patient Services Agreement', {
      x: MARGIN,
      y: height - MARGIN - 15,
      size: 9,
      font: body,
      color: MUTED,
    });
    page.drawLine({
      start: { x: MARGIN, y: height - MARGIN - 26 },
      end: { x: width - MARGIN, y: height - MARGIN - 26 },
      thickness: 0.75,
      color: RULE,
    });

    // Footer.
    page.drawLine({
      start: { x: MARGIN, y: MARGIN + 18 },
      end: { x: width - MARGIN, y: MARGIN + 18 },
      thickness: 0.75,
      color: RULE,
    });
    page.drawText('Reference PSA-2026-0417', {
      x: MARGIN,
      y: MARGIN + 6,
      size: 8,
      font: body,
      color: MUTED,
    });
    const pageLabel = `Page ${index} of ${total}`;
    page.drawText(pageLabel, {
      x: width - MARGIN - body.widthOfTextAtSize(pageLabel, 8),
      y: MARGIN + 6,
      size: 8,
      font: body,
      color: MUTED,
    });

    return { page, width, height, cursor: height - MARGIN - 60 };
  };

  // Page 1: title block, then the first sections.
  let state = newPage(1);
  state.page.drawText('Patient Services Agreement', {
    x: MARGIN,
    y: state.cursor,
    size: 22,
    font: bold,
    color: INK,
  });
  state.cursor -= 22;
  state.page.drawText('Between HealthProHub Clinics Ltd and the Patient named below', {
    x: MARGIN,
    y: state.cursor,
    size: 10,
    font: body,
    color: MUTED,
  });
  state.cursor -= 34;

  for (const [index, section] of SECTIONS.entries()) {
    // Two sections to a page keeps the layout airy and the text legible when a
    // screenshot is scaled down into a contact sheet.
    if (index > 0 && index % 2 === 0) {
      state = newPage(Math.floor(index / 2) + 1);
    }
    state.page.drawText(section.heading, {
      x: MARGIN,
      y: state.cursor,
      size: 12,
      font: bold,
      color: INK,
    });
    state.cursor -= 18;
    for (const line of section.body) {
      state.page.drawText(line, { x: MARGIN, y: state.cursor, size: 10, font: body, color: INK });
      state.cursor -= 15;
    }
    state.cursor -= 22;
  }

  // Filler pages, so the viewer's paging controls have somewhere to go.
  for (let n = 4; n <= 5; n += 1) {
    const filler = newPage(n);
    filler.page.drawText(`Schedule ${n === 4 ? 'A — Services' : 'B — Fees'}`, {
      x: MARGIN,
      y: filler.cursor,
      size: 12,
      font: bold,
      color: INK,
    });
    let y = filler.cursor - 24;
    for (let row = 1; row <= 8; row += 1) {
      filler.page.drawText(
        n === 4
          ? `A${row}.  Consultation type ${row} — delivered at the Riverside clinic`
          : `B${row}.  Item ${row} — charged per session, excluding consumables`,
        { x: MARGIN, y, size: 10, font: body, color: INK },
      );
      y -= 16;
      filler.page.drawLine({
        start: { x: MARGIN, y: y + 6 },
        end: { x: filler.width - MARGIN, y: y + 6 },
        thickness: 0.5,
        color: RULE,
      });
      y -= 6;
    }
  }

  // Page 6: the signature block the gallery places fields onto.
  const last = newPage(6);
  last.page.drawText('Signatures', {
    x: MARGIN,
    y: last.cursor,
    size: 12,
    font: bold,
    color: INK,
  });
  let y = last.cursor - 26;
  last.page.drawText(
    'By signing below each party confirms they have read and accept this agreement.',
    { x: MARGIN, y, size: 10, font: body, color: INK },
  );
  y -= 46;

  for (const party of ['For HealthProHub Clinics Ltd', 'Patient']) {
    last.page.drawText(party, { x: MARGIN, y, size: 9, font: bold, color: MUTED });
    y -= 40;
    for (const [label, x, width] of [
      ['Signature', MARGIN, 220],
      ['Date', MARGIN + 260, 140],
    ]) {
      last.page.drawLine({
        start: { x, y },
        end: { x: x + width, y },
        thickness: 0.75,
        color: RULE,
      });
      last.page.drawText(label, { x, y: y - 12, size: 8, font: body, color: MUTED });
    }
    y -= 56;
  }

  const bytes = await doc.save();
  const out = join(dir, 'demo-agreement.pdf');
  writeFileSync(out, bytes);
  // biome-ignore lint/suspicious/noConsole: CLI script output
  console.log(`Wrote ${out} (${total} pages, ${bytes.length} bytes)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
