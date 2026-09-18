import type { FieldType, SubmitSigningInput } from '@envelope/shared';

export interface SignerField {
  id: string;
  type: FieldType;
  required: boolean;
  pageNumber: number;
}

export interface AdoptedImages {
  signatureImageKey: string | null;
  initialsImageKey: string | null;
}

export interface FieldValue {
  id: string;
  /** Text, "true"/"false", a date, or the storage key of an image. Null when left empty. */
  value: string | null;
  isCompleted: boolean;
}

export type FieldValuesResult =
  | { ok: true; values: FieldValue[] }
  | { ok: false; problem: 'UNKNOWN_FIELD' | 'DUPLICATE_FIELD'; fieldIds: string[] }
  | { ok: false; problem: 'INCOMPLETE'; fieldIds: string[] };

/**
 * Works out what goes into each of a signer's fields when they finish.
 *
 * - Only the signer's own fields may appear. Anything else is refused whole, and
 *   the refusal does not say whether the id belongs to someone else.
 * - DATE_SIGNED is always today's date from the server (docs/08, FLD-05).
 * - SIGNATURE and INITIALS take the adopted image: always for required fields,
 *   and for optional ones only when listed.
 * - A required checkbox must be ticked; required text must not be blank.
 */
export function resolveFieldValues(
  fields: readonly SignerField[],
  submitted: SubmitSigningInput['fields'],
  adopted: AdoptedImages,
  signedAt: Date,
): FieldValuesResult {
  const own = new Map(fields.map((field) => [field.id, field]));
  const answers = new Map<string, string | undefined>();
  const duplicates: string[] = [];
  const unknown: string[] = [];
  for (const entry of submitted) {
    if (!own.has(entry.id)) unknown.push(entry.id);
    else if (answers.has(entry.id)) duplicates.push(entry.id);
    else answers.set(entry.id, entry.value);
  }
  if (unknown.length > 0) return { ok: false, problem: 'UNKNOWN_FIELD', fieldIds: unknown };
  if (duplicates.length > 0) return { ok: false, problem: 'DUPLICATE_FIELD', fieldIds: duplicates };

  const signedDate = signedAt.toISOString().slice(0, 10);
  const values: FieldValue[] = [];
  const missing: string[] = [];

  for (const field of fields) {
    const listed = answers.has(field.id);
    const answer = answers.get(field.id);
    let value: string | null = null;

    switch (field.type) {
      case 'DATE_SIGNED':
        value = signedDate;
        break;
      case 'SIGNATURE':
      case 'INITIALS': {
        const image =
          field.type === 'SIGNATURE' ? adopted.signatureImageKey : adopted.initialsImageKey;
        if (field.required || listed) value = image;
        break;
      }
      case 'CHECKBOX':
        value = answer === 'true' ? 'true' : listed ? 'false' : null;
        if (field.required && value !== 'true') value = null;
        break;
      case 'TEXT_INPUT': {
        const text = answer?.trim() ?? '';
        value = text.length > 0 ? text : null;
        break;
      }
    }

    if (field.required && value === null) missing.push(field.id);
    values.push({ id: field.id, value, isCompleted: value !== null });
  }

  if (missing.length > 0) return { ok: false, problem: 'INCOMPLETE', fieldIds: missing };
  return { ok: true, values };
}
