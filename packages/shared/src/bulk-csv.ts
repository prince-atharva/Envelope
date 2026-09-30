import { MAX_BULK_CSV_BYTES, MAX_BULK_ROWS } from './limits';
import type { EnvelopeMetadata } from './partner-reference';
import { bulkRowSchema, checkTemplatePeople, type TemplatePerson } from './templates';

/**
 * Bulk send from a spreadsheet (docs/20 step 6, ADR 0028). The browser reads
 * the CSV, checks every row with the same rules the API applies, and shows what
 * would happen before anything is sent. Nothing here depends on the DOM or on
 * Node, so the web app and the tests use one implementation.
 *
 * Layout: one column pair per role of the template, `<Role> name` and
 * `<Role> email`, plus an optional `externalId`. Columns may come in any order.
 */

/** The optional column that becomes the envelope's `externalId`. */
export const BULK_CSV_EXTERNAL_ID_COLUMN = 'externalId';

export function bulkCsvColumns(roleNames: readonly string[]): string[] {
  return [
    ...roleNames.flatMap((role) => [`${role} name`, `${role} email`]),
    BULK_CSV_EXTERNAL_ID_COLUMN,
  ];
}

/** A row to fill in: the header only, which no spreadsheet program can mistake for data. */
export function bulkCsvBlank(roleNames: readonly string[]): string {
  return `${bulkCsvColumns(roleNames).map(csvField).join(',')}\r\n`;
}

/** Quotes a value when it needs it (a comma, a quote or a line break in it). */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * RFC 4180: comma separated, `"` quotes a field, `""` is a quote inside one, and a quoted
 * field may hold commas and line breaks. A leading byte order mark is dropped, `\r\n` and `\n`
 * both end a row, and a blank line is skipped.
 */
export function parseCsv(text: string): { records: string[][]; unterminatedQuote: boolean } {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let fieldStarted = false;

  const endField = () => {
    record.push(field);
    field = '';
    fieldStarted = false;
  };
  const endRecord = () => {
    endField();
    // A line with nothing on it is not a row.
    if (record.length > 1 || record[0]?.trim() !== '') records.push(record);
    record = [];
  };

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i] as string;
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"' && !fieldStarted) {
      quoted = true;
      fieldStarted = true;
    } else if (char === ',') endField();
    else if (char === '\r' || char === '\n') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      endRecord();
    } else {
      field += char;
      fieldStarted = true;
    }
  }
  if (fieldStarted || field !== '' || record.length > 0) endRecord();
  return { records, unterminatedQuote: quoted };
}

export interface BulkCsvRow {
  /** The line in the file, counting the header as line 1. */
  line: number;
  /** Present when the row is fine to send. */
  row?: { recipients: TemplatePerson[]; externalId?: string; metadata?: EnvelopeMetadata };
  /** What is wrong with it, in words a sender can act on. Empty when it is fine. */
  problems: string[];
}

export interface BulkCsvResult {
  /** Problems with the file as a whole: a missing column, too many rows. Nothing can be sent. */
  fileProblems: string[];
  /** Columns that were ignored because no role of the template uses them. */
  ignoredColumns: string[];
  rows: BulkCsvRow[];
}

function utf8Length(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

const key = (value: string) => value.trim().toLowerCase();

/**
 * Reads a CSV against a template's roles. Every row is checked with the rules the API uses
 * (`bulkRowSchema` and `checkTemplatePeople`), so a row shown as fine here is accepted there.
 */
export function parseBulkCsv(text: string, roleNames: readonly string[]): BulkCsvResult {
  const result: BulkCsvResult = { fileProblems: [], ignoredColumns: [], rows: [] };
  if (utf8Length(text) > MAX_BULK_CSV_BYTES) {
    result.fileProblems.push('That file is too large to be a batch. Split it into smaller files.');
    return result;
  }
  const { records, unterminatedQuote } = parseCsv(text);
  if (unterminatedQuote) {
    result.fileProblems.push(
      'A quoted value is never closed, so the rest of the file cannot be read.',
    );
    return result;
  }
  const [header, ...body] = records;
  if (!header) {
    result.fileProblems.push('The file is empty. It needs a header row and one row per person.');
    return result;
  }

  const columnOf = new Map(header.map((name, index) => [key(name), index]));
  const wanted = roleNames.flatMap((role) => [`${role} name`, `${role} email`]);
  for (const column of wanted) {
    if (!columnOf.has(key(column))) result.fileProblems.push(`The column “${column}” is missing.`);
  }
  const known = new Set([...wanted, BULK_CSV_EXTERNAL_ID_COLUMN].map(key));
  result.ignoredColumns = header.filter((name) => name.trim() !== '' && !known.has(key(name)));
  if (result.fileProblems.length > 0) return result;

  if (body.length === 0) {
    result.fileProblems.push('The file has a header but no rows.');
    return result;
  }
  if (body.length > MAX_BULK_ROWS) {
    result.fileProblems.push(
      `A batch can have at most ${MAX_BULK_ROWS} rows; this file has ${body.length}. Split it into smaller files.`,
    );
    return result;
  }

  const cell = (record: string[], column: string) =>
    (record[columnOf.get(key(column)) ?? -1] ?? '').trim();
  body.forEach((record, index) => {
    const line = index + 2;
    const recipients = roleNames.map((role) => ({
      role,
      name: cell(record, `${role} name`),
      email: cell(record, `${role} email`),
    }));
    const externalId = cell(record, BULK_CSV_EXTERNAL_ID_COLUMN);
    const problems: string[] = [];

    for (const person of recipients) {
      if (person.name === '') problems.push(`${person.role}: the name is empty.`);
      if (person.email === '') problems.push(`${person.role}: the email address is empty.`);
    }
    const parsed = bulkRowSchema.safeParse({
      recipients,
      ...(externalId === '' ? {} : { externalId }),
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const [, position, field] = issue.path;
        const who = typeof position === 'number' ? recipients[position]?.role : undefined;
        // An empty value is reported above, in plainer words.
        if (
          who &&
          (field === 'name' || field === 'email') &&
          recipients[position as number]?.[field] === ''
        )
          continue;
        problems.push(
          who
            ? `${who}: ${issue.message.toLowerCase()}`
            : `${String(issue.path[0] ?? 'row')}: ${issue.message}`,
        );
      }
    } else {
      for (const problem of checkTemplatePeople(roleNames, parsed.data.recipients)) {
        if (problem.code === 'DUPLICATE_EMAIL') {
          problems.push('The same email address is used for more than one role.');
        }
      }
    }
    result.rows.push(
      problems.length === 0 && parsed.success
        ? { line, row: parsed.data, problems }
        : { line, problems },
    );
  });
  return result;
}
