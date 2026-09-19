import type { PDFDocument, PDFFont, PDFPage } from 'pdf-lib';
import { rgb } from 'pdf-lib';

/** One signer or approver, as the certificate reports them. */
export interface CertificateParty {
  name: string;
  email: string;
  role: 'SIGNER' | 'APPROVER';
  signedAt: Date;
  consentGivenAt: Date | null;
  /** From their RECIPIENT_SIGNED event, as recorded by the server. */
  ipAddress: string;
  userAgent: string;
  signatureMethod: string | null;
  /** The version they were shown and signed (ADR 0003). */
  documentVersion: number | null;
}

export interface CertificateVersion {
  versionNumber: number;
  sha256: string;
  /** Who produced it; null for the original. */
  createdBy: string | null;
  createdAt: Date;
}

export interface CertificateEvent {
  sequence: number;
  timestamp: Date;
  action: string;
  /** A person's name, or "System". */
  actor: string;
  ipAddress: string;
}

/**
 * Everything the certificate prints. Every date comes from the records, never
 * from the clock, so a retried seal draws exactly the same page.
 */
export interface CertificateData {
  envelopeId: string;
  title: string;
  originalFilename: string;
  sender: string;
  sentAt: Date | null;
  /** When the last party signed. */
  signedByAllAt: Date;
  parties: CertificateParty[];
  versions: CertificateVersion[];
  events: CertificateEvent[];
}

/** What the certificate says, before it is laid out on pages. */
export type CertificateBlock =
  | { kind: 'title'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'field'; label: string; value: string }
  | { kind: 'note'; text: string }
  | { kind: 'row'; cells: string[]; header?: boolean }
  | { kind: 'gap' };

const ACTIONS: Record<string, string> = {
  ENVELOPE_CREATED: 'Envelope created',
  ENVELOPE_UPDATED: 'Envelope edited',
  RECIPIENT_ADDED: 'Recipient added',
  RECIPIENT_UPDATED: 'Recipient edited',
  RECIPIENT_REMOVED: 'Recipient removed',
  FIELDS_SAVED: 'Fields placed',
  ENVELOPE_SENT: 'Envelope sent',
  EMAIL_SENT: 'Email sent',
  REMINDER_REQUESTED: 'Reminder requested',
  ENVELOPE_VIEWED: 'Signing link opened',
  CONSENT_GIVEN: 'Consent to sign electronically',
  SIGNATURE_ADOPTED: 'Signature adopted',
  RECIPIENT_SIGNED: 'Signed',
  RECIPIENT_DECLINED: 'Declined',
  VERSION_CREATED: 'Version created',
};

export function describeAction(action: string): string {
  return ACTIONS[action] ?? action.toLowerCase().replaceAll('_', ' ');
}

/** "2026-09-19 14:03:22 UTC" */
export function utc(date: Date): string {
  return `${date.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

/** The event table's columns: #, time, event, by, IP. Widths in points. */
export const EVENT_COLUMNS = [26, 118, 150, 120, 90] as const;

/**
 * The certificate's content (docs/06): the document, each party's evidence,
 * the fingerprint of every version, and the event history.
 *
 * The fingerprint of the finished file is deliberately absent. It is taken
 * over these very pages, so it cannot be printed on them (docs/06,
 * Correction 3). It is kept on record and shown by Verify and in the email.
 */
export function certificateBlocks(data: CertificateData): CertificateBlock[] {
  const blocks: CertificateBlock[] = [
    { kind: 'title', text: 'Certificate of Completion' },
    { kind: 'field', label: 'Document', value: data.title },
    { kind: 'field', label: 'File', value: data.originalFilename },
    { kind: 'field', label: 'Envelope ID', value: data.envelopeId },
    { kind: 'field', label: 'Sent by', value: data.sender },
    ...(data.sentAt ? [{ kind: 'field' as const, label: 'Sent', value: utc(data.sentAt) }] : []),
    { kind: 'field', label: 'Signed by all', value: utc(data.signedByAllAt) },
    { kind: 'gap' },
    { kind: 'heading', text: 'Signers' },
  ];

  for (const party of data.parties) {
    blocks.push(
      { kind: 'field', label: 'Name', value: party.name },
      { kind: 'field', label: 'Email', value: party.email },
      { kind: 'field', label: 'Role', value: titleCase(party.role) },
      { kind: 'field', label: 'Signed', value: utc(party.signedAt) },
      {
        kind: 'field',
        label: 'Consent given',
        value: party.consentGivenAt ? utc(party.consentGivenAt) : 'Not recorded',
      },
      {
        kind: 'field',
        label: 'Signature',
        value: party.signatureMethod ? titleCase(party.signatureMethod) : 'None (no signature box)',
      },
      ...(party.documentVersion === null
        ? []
        : [
            {
              kind: 'field' as const,
              label: 'Signed version',
              value: `v${party.documentVersion}`,
            },
          ]),
      { kind: 'field', label: 'IP address', value: party.ipAddress },
      { kind: 'field', label: 'Device', value: party.userAgent },
      { kind: 'gap' },
    );
  }

  blocks.push(
    { kind: 'heading', text: 'Document versions' },
    {
      kind: 'note',
      text:
        'Each version is the document with one more signature stamped into it. The SHA-256 ' +
        'fingerprint identifies that exact file. The fingerprint of this finished file, ' +
        'certificate included, is kept on record and can be checked on the Verify page.',
    },
  );
  for (const version of data.versions) {
    blocks.push({
      kind: 'field',
      label: `v${version.versionNumber}`,
      value:
        `${version.sha256}\n` +
        `${version.createdBy ? `Signed by ${version.createdBy}` : 'Original upload'}, ` +
        utc(version.createdAt),
    });
  }

  blocks.push(
    { kind: 'gap' },
    { kind: 'heading', text: 'Event history' },
    { kind: 'row', header: true, cells: ['#', 'Time', 'Event', 'By', 'IP address'] },
    ...data.events.map(
      (event): CertificateBlock => ({
        kind: 'row',
        cells: [
          String(event.sequence),
          utc(event.timestamp),
          describeAction(event.action),
          event.actor,
          event.ipAddress,
        ],
      }),
    ),
  );
  return blocks;
}

// ── Layout ─────────────────────────────────────────────────────────────────

/** US Letter, whatever the document's own size (docs/15, deliberate simplifications). */
export const CERTIFICATE_PAGE: [number, number] = [612, 792];
const MARGIN = 54;
const FOOTER_Y = 30;
const LABEL_WIDTH = 110;
const INK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.4, 0.4, 0.4);
const RULE = rgb(0.8, 0.8, 0.8);

const SIZE = { title: 18, heading: 11, text: 9, note: 8, row: 7.5, footer: 7 } as const;
const LEADING = 1.35;

export interface CertificateFonts {
  regular: PDFFont;
  bold: PDFFont;
  /** Makes text drawable in the embedded font, replacing what it lacks. */
  drawable: (value: string) => string;
}

/**
 * Splits text into lines that fit `width`, at spaces where possible and inside
 * a word only when one word is wider than the line (a fingerprint, a device).
 */
export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = '';
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > width) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut -= 1;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Draws the blocks onto new pages at the end of `pdf`, starting a page
 * whenever the current one is full, and numbers the certificate's pages.
 * Returns how many pages it added.
 */
export function drawCertificate(
  pdf: PDFDocument,
  blocks: readonly CertificateBlock[],
  fonts: CertificateFonts,
  envelopeId: string,
): number {
  const [pageWidth, pageHeight] = CERTIFICATE_PAGE;
  const width = pageWidth - MARGIN * 2;
  const bottom = FOOTER_Y + 24;
  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  let header: Extract<CertificateBlock, { kind: 'row' }> | undefined;

  const newPage = () => {
    page = pdf.addPage(CERTIFICATE_PAGE);
    pages.push(page);
    y = pageHeight - MARGIN;
  };
  /** Moves down by `height`, first starting a new page if it would not fit. */
  const room = (height: number) => {
    if (y - height < bottom) newPage();
  };
  const line = (text: string, x: number, size: number, font: PDFFont, color = INK) => {
    page.drawText(text, { x, y: y - size, size, font, color });
  };

  newPage();
  for (const [index, block] of blocks.entries()) {
    switch (block.kind) {
      case 'title': {
        room(SIZE.title * LEADING);
        line(fonts.drawable(block.text), MARGIN, SIZE.title, fonts.bold);
        y -= SIZE.title * LEADING + 6;
        break;
      }
      case 'heading': {
        // Never leave a heading alone at the foot of a page.
        const next = blocks[index + 1];
        const following = next && next.kind !== 'gap' ? SIZE.text * LEADING * 3 : 0;
        room(SIZE.heading * LEADING + 8 + following);
        line(fonts.drawable(block.text), MARGIN, SIZE.heading, fonts.bold);
        y -= SIZE.heading * LEADING + 2;
        page.drawLine({
          start: { x: MARGIN, y },
          end: { x: MARGIN + width, y },
          thickness: 0.5,
          color: RULE,
        });
        y -= 6;
        break;
      }
      case 'field': {
        const lines = wrap(
          fonts.drawable(block.value),
          fonts.regular,
          SIZE.text,
          width - LABEL_WIDTH,
        );
        const lead = SIZE.text * LEADING;
        room(lead * Math.min(lines.length, 2));
        line(fonts.drawable(block.label), MARGIN, SIZE.text, fonts.bold, MUTED);
        for (const text of lines) {
          room(lead);
          line(text, MARGIN + LABEL_WIDTH, SIZE.text, fonts.regular);
          y -= lead;
        }
        break;
      }
      case 'note': {
        for (const text of wrap(fonts.drawable(block.text), fonts.regular, SIZE.note, width)) {
          room(SIZE.note * LEADING);
          line(text, MARGIN, SIZE.note, fonts.regular, MUTED);
          y -= SIZE.note * LEADING;
        }
        y -= 4;
        break;
      }
      case 'row': {
        const drawRow = (row: typeof block) => {
          const font = row.header ? fonts.bold : fonts.regular;
          const cells = row.cells.map((cell, column) =>
            wrap(fonts.drawable(cell), font, SIZE.row, (EVENT_COLUMNS[column] ?? 60) - 6),
          );
          const height = Math.max(...cells.map((c) => c.length)) * SIZE.row * LEADING + 3;
          const before = pages.length;
          room(height);
          // A table carried onto a new page repeats its column names.
          if (pages.length > before && !row.header && header) drawRow(header);
          let x = MARGIN;
          for (const [column, texts] of cells.entries()) {
            const top = y;
            for (const text of texts) {
              line(text, x, SIZE.row, font, row.header ? MUTED : INK);
              y -= SIZE.row * LEADING;
            }
            y = top;
            x += EVENT_COLUMNS[column] ?? 60;
          }
          y -= height;
        };
        if (block.header) header = block;
        drawRow(block);
        break;
      }
      case 'gap':
        y -= 10;
        break;
    }
  }

  for (const [index, current] of pages.entries()) {
    const footer = `Certificate of Completion  ·  Envelope ${envelopeId}  ·  Page ${index + 1} of ${pages.length}`;
    current.drawText(footer, {
      x: MARGIN,
      y: FOOTER_Y,
      size: SIZE.footer,
      font: fonts.regular,
      color: MUTED,
    });
  }
  return pages.length;
}
