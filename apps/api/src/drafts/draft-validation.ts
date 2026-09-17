import { createHash } from 'node:crypto';
import {
  type FieldInput,
  PIXEL_COORDINATE_KEYS,
  type Ratios,
  roundRatios,
  validateRatios,
} from '@envelope/shared';
import { AppException } from '../common/errors/app-exception';

/**
 * Rejects a layout that carries pixel or point coordinates.
 *
 * Runs BEFORE zod, because zod's strictObject would report the same mistake as a
 * generic VALIDATION_FAILED. docs/08 asks for INVALID_COORDINATE_SPACE with the
 * offending path, so the client learns what it did wrong rather than that
 * something, somewhere, was unexpected.
 */
export function rejectPixelCoordinates(body: unknown): void {
  const fields = (body as { fields?: unknown })?.fields;
  if (!Array.isArray(fields)) return;

  const offenders = fields.flatMap((field, index) => {
    if (typeof field !== 'object' || field === null) return [];
    return PIXEL_COORDINATE_KEYS.filter((key) => key in field).map((key) => ({
      path: `fields[${index}].${key}`,
      message: 'Send ratios (ratioX, ratioY, ratioWidth, ratioHeight), never pixels or points.',
    }));
  });

  if (offenders.length > 0) {
    throw new AppException(
      'INVALID_COORDINATE_SPACE',
      'Field positions must be page ratios, not pixels.',
      { errors: offenders },
    );
  }
}

/**
 * Checks one field's geometry with the shared validator, so the API rejects
 * exactly what the builder marks as invalid and what the database constraints
 * would refuse.
 */
export function assertValidGeometry(field: FieldInput, index: number, pageCount: number): Ratios {
  const ratios = roundRatios(field);

  const problem = validateRatios(ratios);
  if (problem === 'RATIO_OUT_OF_RANGE') {
    throw new AppException('RATIO_OUT_OF_RANGE', 'A field position is outside the page.', {
      errors: [{ path: `fields[${index}]`, message: 'Every ratio must be between 0 and 1.' }],
    });
  }
  if (problem === 'FIELD_EXCEEDS_PAGE') {
    throw new AppException('FIELD_EXCEEDS_PAGE', 'A field runs off the edge of the page.', {
      errors: [
        {
          path: `fields[${index}]`,
          message: 'Position plus size must not exceed the page.',
        },
      ],
    });
  }

  if (field.pageNumber > pageCount) {
    throw new AppException('PAGE_OUT_OF_RANGE', `This document has ${pageCount} pages.`, {
      errors: [{ path: `fields[${index}].pageNumber`, message: 'No such page.' }],
    });
  }

  return ratios;
}

/** Everything a layout hash depends on: a saved row and an incoming field both fit. */
export interface LayoutEntry extends Ratios {
  id: string;
  recipientId: string;
  type: string;
  pageNumber: number;
  required: boolean;
}

/**
 * A stable fingerprint of a layout.
 *
 * Autosave sends the whole layout after every change, including changes that
 * move nothing (selecting a field, say). Comparing this hash lets an unchanged
 * layout be skipped entirely: no audit row, no revision bump, no write.
 */
export function layoutHash(fields: readonly LayoutEntry[]): string {
  const canonical = fields
    .map((f) =>
      [
        f.id,
        f.recipientId,
        f.type,
        f.pageNumber,
        f.required ? 1 : 0,
        f.ratioX,
        f.ratioY,
        f.ratioWidth,
        f.ratioHeight,
      ].join(':'),
    )
    .sort()
    .join('|');
  return createHash('sha256').update(canonical).digest('hex');
}
