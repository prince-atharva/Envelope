import { describe, expect, it } from 'vitest';
import { bulkCsvBlank, bulkCsvColumns, csvField, parseBulkCsv, parseCsv } from './bulk-csv';
import { MAX_BULK_ROWS } from './limits';
import { createBulkBatchSchema } from './templates';

const ROLES = ['Patient', 'Doctor'];
const HEADER = 'Patient name,Patient email,Doctor name,Doctor email,externalId';

describe('parseCsv', () => {
  it('reads plain rows with either kind of line ending and skips blank lines', () => {
    expect(parseCsv('a,b\r\nc,d\n\n\ne,f\n').records).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
    ]);
  });

  it('reads quoted values with commas, quotes and line breaks', () => {
    const { records } = parseCsv('"Lee, Jordan","says ""hi""","two\nlines"\n');
    expect(records).toEqual([['Lee, Jordan', 'says "hi"', 'two\nlines']]);
  });

  it('drops a byte order mark, keeps empty fields, and reads a final row with no newline', () => {
    expect(parseCsv('﻿a,,c\n1,2,3').records).toEqual([
      ['a', '', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('reports a quote that never closes', () => {
    expect(parseCsv('a,"b\nc').unterminatedQuote).toBe(true);
    expect(parseCsv('a,"b"\n').unterminatedQuote).toBe(false);
  });

  it('round-trips what csvField writes', () => {
    const values = ['plain', 'a,b', 'say "x"', 'line\nbreak', ''];
    const line = values.map(csvField).join(',');
    expect(parseCsv(`${line}\n`).records).toEqual([values]);
  });
});

describe('bulkCsvBlank', () => {
  it('is the header alone, with a pair of columns per role', () => {
    expect(bulkCsvColumns(ROLES)).toEqual([
      'Patient name',
      'Patient email',
      'Doctor name',
      'Doctor email',
      'externalId',
    ]);
    expect(bulkCsvBlank(ROLES)).toBe(`${HEADER}\r\n`);
    expect(bulkCsvBlank(['A, B'])).toBe('"A, B name","A, B email",externalId\r\n');
  });
});

describe('parseBulkCsv', () => {
  it('turns good rows into rows the API accepts', () => {
    const result = parseBulkCsv(
      `${HEADER}\nAlex Morgan,ALEX@example.com,Dr Rivera,rivera@example.com,visit:1\nSam,sam@example.com,Dr Rivera,rivera@example.com,\n`,
      ROLES,
    );
    expect(result.fileProblems).toEqual([]);
    expect(result.rows.map((r) => r.problems)).toEqual([[], []]);
    expect(result.rows[0]).toMatchObject({ line: 2 });
    expect(result.rows[0]?.row?.recipients[0]).toEqual({
      role: 'Patient',
      name: 'Alex Morgan',
      email: 'alex@example.com',
    });
    expect(result.rows[0]?.row?.externalId).toBe('visit:1');
    expect(result.rows[1]?.row?.externalId).toBeUndefined();
    const parity = createBulkBatchSchema.safeParse({
      rows: result.rows.map((r) => r.row),
    });
    expect(parity.success).toBe(true);
  });

  it('finds columns in any order, in any case, and notes the ones it ignores', () => {
    const result = parseBulkCsv(
      'DOCTOR EMAIL,doctor name,patient email,Patient Name,Notes\nd@example.com,Dr D,p@example.com,Pat,hello\n',
      ROLES,
    );
    expect(result.fileProblems).toEqual([]);
    expect(result.ignoredColumns).toEqual(['Notes']);
    expect(result.rows[0]?.row?.recipients.map((p) => p.name)).toEqual(['Pat', 'Dr D']);
  });

  it('refuses a file with a missing column, no rows, an empty file, or too many rows', () => {
    expect(
      parseBulkCsv('Patient name,Patient email\nA,a@example.com\n', ROLES).fileProblems,
    ).toEqual(['The column “Doctor name” is missing.', 'The column “Doctor email” is missing.']);
    expect(parseBulkCsv(`${HEADER}\n`, ROLES).fileProblems).toEqual([
      'The file has a header but no rows.',
    ]);
    expect(parseBulkCsv('', ROLES).fileProblems[0]).toMatch(/empty/);
    const many = `${HEADER}\n${'A,a@example.com,B,b@example.com,\n'.repeat(MAX_BULK_ROWS + 1)}`;
    expect(parseBulkCsv(many, ROLES).fileProblems[0]).toMatch(/at most 500 rows/);
    expect(parseBulkCsv(`${HEADER}\n"A,a@example.com`, ROLES).fileProblems[0]).toMatch(
      /never closed/,
    );
  });

  it('points at each bad row by line, in words, and keeps the good rows', () => {
    const result = parseBulkCsv(
      [
        HEADER,
        'Alex,alex@example.com,Dr R,r@example.com,',
        ',nope,Dr R,r@example.com,',
        'Sam,sam@example.com,Dr R,sam@example.com,',
        'Kit,kit@example.com,Dr R,r@example.com,has space',
      ].join('\n'),
      ROLES,
    );
    expect(result.rows.map((r) => [r.line, r.row ? 'ok' : 'bad'])).toEqual([
      [2, 'ok'],
      [3, 'bad'],
      [4, 'bad'],
      [5, 'bad'],
    ]);
    expect(result.rows[1]?.problems).toEqual(
      expect.arrayContaining(['Patient: the name is empty.']),
    );
    expect(result.rows[1]?.problems.join(' ')).toMatch(/Patient: .*email/i);
    expect(result.rows[2]?.problems).toEqual([
      'The same email address is used for more than one role.',
    ]);
    expect(result.rows[3]?.problems[0]).toMatch(/externalId/);
  });

  it('agrees with the API about every row it calls fine, and every row it refuses', () => {
    const text = [
      HEADER,
      'A,a@example.com,B,b@example.com,',
      'A,A@EXAMPLE.COM,B,a@example.com,',
      'A,not-an-email,B,b@example.com,',
    ].join('\n');
    const { rows } = parseBulkCsv(text, ROLES);
    for (const r of rows) {
      const accepted = r.row ? createBulkBatchSchema.safeParse({ rows: [r.row] }).success : false;
      expect(accepted).toBe(r.problems.length === 0);
    }
    expect(rows.map((r) => r.problems.length === 0)).toEqual([true, false, false]);
  });

  it('refuses an oversize file before reading it', () => {
    const big = `${HEADER}\n${'x'.repeat(1024 * 1024 + 1)}`;
    expect(parseBulkCsv(big, ROLES).fileProblems[0]).toMatch(/too large/);
  });
});
