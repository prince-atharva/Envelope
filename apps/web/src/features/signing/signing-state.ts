import type {
  FieldType,
  SignatureKind,
  SigningField,
  SigningSession,
  SubmitSigningInput,
} from '@envelope/shared';
import { FIELD_LABEL } from '../../lib/labels';

/**
 * What the signer has filled in, by field id.
 *
 * - TEXT_INPUT: the text.
 * - CHECKBOX: "true" or "false".
 * - SIGNATURE and INITIALS: SIGNED_MARK once they have tapped the box. The image
 *   itself is adopted once, on the server, and goes into every box they tapped.
 * - DATE_SIGNED: never; the server fills it in.
 */
export type FieldValues = Readonly<Record<string, string>>;

export const SIGNED_MARK = 'signed';

export type Adopted = SigningSession['adopted'];

export function isSignatureKind(type: FieldType): type is SignatureKind {
  return type === 'SIGNATURE' || type === 'INITIALS';
}

/** Whether a field holds what it needs. A date always does: the server writes it. */
export function isFilled(field: SigningField, values: FieldValues, adopted: Adopted): boolean {
  const value = values[field.id];
  switch (field.type) {
    case 'DATE_SIGNED':
      return true;
    case 'SIGNATURE':
    case 'INITIALS':
      return value === SIGNED_MARK && adopted[field.type] !== undefined;
    case 'CHECKBOX':
      return value === 'true';
    case 'TEXT_INPUT':
      return (value ?? '').trim().length > 0;
  }
}

/** Fields the signer must do something about before Finish. */
export function requiredFields(fields: readonly SigningField[]): SigningField[] {
  return fields.filter((field) => field.required && field.type !== 'DATE_SIGNED');
}

export interface SigningProgress {
  done: number;
  total: number;
  complete: boolean;
}

export function signingProgress(
  fields: readonly SigningField[],
  values: FieldValues,
  adopted: Adopted,
): SigningProgress {
  const required = requiredFields(fields);
  const done = required.filter((field) => isFilled(field, values, adopted)).length;
  return { done, total: required.length, complete: done === required.length };
}

/**
 * Where Next goes: the first required field still empty after `afterId`, in
 * reading order, wrapping round to the start (docs/09, "Guided navigation").
 * Pressing Next without filling a box moves on rather than staying put.
 *
 * `fields` must already be in reading order, as the session returns them.
 */
export function nextField(
  fields: readonly SigningField[],
  values: FieldValues,
  adopted: Adopted,
  afterId: string | null,
): SigningField | null {
  const open = (field: SigningField) =>
    field.required && field.type !== 'DATE_SIGNED' && !isFilled(field, values, adopted);
  const start = afterId === null ? -1 : fields.findIndex((field) => field.id === afterId);
  for (let step = 1; step <= fields.length; step += 1) {
    const field = fields[(start + step + fields.length) % fields.length];
    if (field && open(field)) return field;
  }
  return null;
}

/** The body of POST /sign/:token/submit. */
export function toSubmission(
  fields: readonly SigningField[],
  values: FieldValues,
  adopted: Adopted,
): SubmitSigningInput {
  const entries: SubmitSigningInput['fields'] = [];
  for (const field of fields) {
    const value = values[field.id];
    if (value === undefined) continue;
    switch (field.type) {
      case 'SIGNATURE':
      case 'INITIALS':
        if (isFilled(field, values, adopted)) entries.push({ id: field.id });
        break;
      case 'CHECKBOX':
        entries.push({ id: field.id, value: value === 'true' ? 'true' : 'false' });
        break;
      case 'TEXT_INPUT': {
        const text = value.trim();
        if (text.length > 0) entries.push({ id: field.id, value: text });
        break;
      }
      case 'DATE_SIGNED':
        break;
    }
  }
  return { fields: entries };
}

export function fieldTypeName(type: FieldType): string {
  return FIELD_LABEL[type];
}

/** What a screen reader announces: "Signature field, required, page 4 of 12" (docs/09). */
export function fieldAccessibleName(field: SigningField, pageCount: number): string {
  return `${FIELD_LABEL[field.type]} field, ${field.required ? 'required' : 'optional'}, page ${
    field.pageNumber
  } of ${pageCount}`;
}
