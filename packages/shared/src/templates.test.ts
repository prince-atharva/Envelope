import { describe, expect, it } from 'vitest';
import { MAX_BULK_ROWS } from './limits';
import {
  checkTemplatePeople,
  createBulkBatchSchema,
  createFromTemplateSchema,
  createTemplateSchema,
  listTemplatesQuerySchema,
  updateTemplateSchema,
} from './templates';

const person = (role: string, email: string) => ({ role, name: 'Sam', email });

describe('template schemas', () => {
  it('accepts a template to save and trims its name', () => {
    const parsed = createTemplateSchema.parse({
      envelopeId: '0192c8a0-0000-7000-8000-000000000001',
      name: '  Intake form ',
    });
    expect(parsed.name).toBe('Intake form');
  });

  it('refuses an empty update and unknown keys', () => {
    expect(updateTemplateSchema.safeParse({}).success).toBe(false);
    expect(updateTemplateSchema.safeParse({ name: 'x', pages: 3 }).success).toBe(false);
    expect(updateTemplateSchema.safeParse({ archived: true }).success).toBe(true);
    expect(updateTemplateSchema.safeParse({ description: null }).success).toBe(true);
  });

  it('reads the archived flag from a query string without treating "false" as true', () => {
    expect(listTemplatesQuerySchema.parse({ archived: 'false' }).archived).toBe(false);
    expect(listTemplatesQuerySchema.parse({ archived: 'true' }).archived).toBe(true);
    expect(listTemplatesQuerySchema.safeParse({ archived: 'yes' }).success).toBe(false);
  });

  it('defaults to a draft, not a send', () => {
    const one = createFromTemplateSchema.parse({
      recipients: [person('Patient', 'a@example.com')],
    });
    expect(one.send).toBe(false);
    const many = createBulkBatchSchema.parse({
      rows: [{ recipients: [person('Patient', 'a@example.com')] }],
    });
    expect(many.send).toBe(false);
  });

  it('does not cap the row count itself, so the API can answer BULK_TOO_LARGE', () => {
    const rows = Array.from({ length: MAX_BULK_ROWS + 1 }, (_, i) => ({
      recipients: [person('Patient', `p${i}@example.com`)],
    }));
    expect(createBulkBatchSchema.safeParse({ rows }).success).toBe(true);
  });

  it('refuses a batch with no rows and a row with no people', () => {
    expect(createBulkBatchSchema.safeParse({ rows: [] }).success).toBe(false);
    expect(createBulkBatchSchema.safeParse({ rows: [{ recipients: [] }] }).success).toBe(false);
  });
});

describe('checkTemplatePeople', () => {
  const roles = ['Patient', 'Doctor'];

  it('accepts one person for each role', () => {
    expect(
      checkTemplatePeople(roles, [
        person('Patient', 'a@example.com'),
        person('Doctor', 'b@example.com'),
      ]),
    ).toEqual([]);
  });

  it('reports a missing, an unknown and a repeated role', () => {
    const problems = checkTemplatePeople(roles, [
      person('Patient', 'a@example.com'),
      person('Patient', 'b@example.com'),
      person('Nurse', 'c@example.com'),
    ]);
    expect(problems).toEqual([
      { code: 'DUPLICATE_ROLE', role: 'Patient' },
      { code: 'UNKNOWN_ROLE', role: 'Nurse' },
      { code: 'MISSING_ROLE', role: 'Doctor' },
    ]);
  });

  it('reports an email used twice whatever its case', () => {
    expect(
      checkTemplatePeople(roles, [
        person('Patient', 'A@Example.com'),
        person('Doctor', 'a@example.com'),
      ]),
    ).toEqual([{ code: 'DUPLICATE_EMAIL', email: 'a@example.com' }]);
  });
});
