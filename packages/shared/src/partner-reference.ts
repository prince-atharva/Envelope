import { z } from 'zod';
import {
  MAX_EXTERNAL_ID_LENGTH,
  MAX_METADATA_BYTES,
  MAX_METADATA_KEY_LENGTH,
  MAX_METADATA_KEYS,
  MAX_METADATA_VALUE_LENGTH,
} from './limits';

/**
 * A partner's own identifier for an envelope, and a few small labels
 * (docs/18 workstream 10, ADR 0019). Both echo in every webhook for the
 * envelope; neither is ever unique-checked or searched beyond an exact
 * `externalId` match, and both are fixed once the envelope is sent.
 */
/** UTF-8 size without TextEncoder or Buffer, which this package's targets (API and browser) do not share. */
function utf8Length(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

export const externalIdSchema = z
  .string()
  .min(1)
  .max(MAX_EXTERNAL_ID_LENGTH)
  .regex(/^[a-zA-Z0-9_.:@-]+$/, 'Use letters, digits and _ . : @ - only');

export const envelopeMetadataSchema = z
  .record(
    z
      .string()
      .min(1)
      .max(MAX_METADATA_KEY_LENGTH)
      .regex(/^[a-zA-Z0-9_.-]+$/, 'Use letters, digits and _ . - only'),
    z.string().max(MAX_METADATA_VALUE_LENGTH),
  )
  .refine((value) => Object.keys(value).length <= MAX_METADATA_KEYS, {
    error: `At most ${MAX_METADATA_KEYS} keys`,
  })
  .refine((value) => utf8Length(JSON.stringify(value)) <= MAX_METADATA_BYTES, {
    error: `At most ${MAX_METADATA_BYTES} bytes in total`,
  });
export type EnvelopeMetadata = z.infer<typeof envelopeMetadataSchema>;

/**
 * Multipart forms carry only strings, so `metadata` arrives as JSON text there
 * and as an object in a JSON body. Anything that is not valid JSON falls
 * through as the raw string and fails the object schema with a normal
 * validation error.
 */
function parseJsonText(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** For multipart (`POST /envelopes`, embedded upload): JSON text or an object. */
export const envelopeMetadataFieldSchema = z.preprocess(parseJsonText, envelopeMetadataSchema);
