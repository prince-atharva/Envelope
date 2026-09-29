import { describe, expect, it } from 'vitest';
import { updateEnvelopeSchema } from './draft';
import { createEmbedSessionSchema } from './embed';
import { createEnvelopeSchema, listEnvelopesQuerySchema } from './envelopes';
import {
  MAX_EXTERNAL_ID_LENGTH,
  MAX_METADATA_BYTES,
  MAX_METADATA_KEYS,
  MAX_METADATA_VALUE_LENGTH,
} from './limits';
import { envelopeMetadataSchema, externalIdSchema } from './partner-reference';

describe('externalIdSchema', () => {
  it('accepts a typical record id', () => {
    expect(externalIdSchema.safeParse('hph-visit:2026_09.28@clinic-1').success).toBe(true);
  });

  it('rejects empty, oversize and unsafe characters', () => {
    expect(externalIdSchema.safeParse('').success).toBe(false);
    expect(externalIdSchema.safeParse('a'.repeat(MAX_EXTERNAL_ID_LENGTH + 1)).success).toBe(false);
    for (const bad of ['has space', 'a/b', '<script>', 'x\ny', 'é']) {
      expect(externalIdSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('envelopeMetadataSchema', () => {
  it('accepts a few string labels', () => {
    expect(
      envelopeMetadataSchema.safeParse({ department: 'billing', 'form.id': '7' }).success,
    ).toBe(true);
  });

  it('rejects non-string values, bad keys and too many keys', () => {
    expect(envelopeMetadataSchema.safeParse({ n: 1 }).success).toBe(false);
    expect(envelopeMetadataSchema.safeParse({ 'bad key': 'x' }).success).toBe(false);
    const many = Object.fromEntries(
      Array.from({ length: MAX_METADATA_KEYS + 1 }, (_, i) => [`k${i}`, 'v']),
    );
    expect(envelopeMetadataSchema.safeParse(many).success).toBe(false);
  });

  it('rejects a value over the length cap and a total over the byte cap', () => {
    expect(
      envelopeMetadataSchema.safeParse({ a: 'x'.repeat(MAX_METADATA_VALUE_LENGTH + 1) }).success,
    ).toBe(false);
    // 10 keys of 250 chars is about 2.6 KB: each value is legal, the whole is not.
    const heavy = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`k${i}`, 'x'.repeat(250)]),
    );
    expect(JSON.stringify(heavy).length).toBeGreaterThan(MAX_METADATA_BYTES);
    expect(envelopeMetadataSchema.safeParse(heavy).success).toBe(false);
  });

  it('counts bytes, not characters', () => {
    const wide = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`k${i}`, '€'.repeat(90)]));
    expect(JSON.stringify(wide).length).toBeLessThan(MAX_METADATA_BYTES);
    expect(envelopeMetadataSchema.safeParse(wide).success).toBe(false);
  });
});

describe('where the fields are accepted', () => {
  it('reads metadata from multipart JSON text on create, and rejects text that is not JSON', () => {
    const ok = createEnvelopeSchema.safeParse({ externalId: 'r-1', metadata: '{"a":"b"}' });
    expect(ok.success && ok.data.metadata).toEqual({ a: 'b' });
    expect(createEnvelopeSchema.safeParse({ metadata: 'not json' }).success).toBe(false);
    expect(createEnvelopeSchema.safeParse({ metadata: '[1]' }).success).toBe(false);
  });

  it('lets a draft update set or clear both fields', () => {
    expect(updateEnvelopeSchema.safeParse({ externalId: null }).success).toBe(true);
    expect(updateEnvelopeSchema.safeParse({ metadata: null }).success).toBe(true);
    expect(
      updateEnvelopeSchema.safeParse({ externalId: 'r-2', metadata: { a: 'b' } }).success,
    ).toBe(true);
  });

  it('filters the list on an exact externalId', () => {
    expect(listEnvelopesQuerySchema.parse({ externalId: 'r-1' }).externalId).toBe('r-1');
    expect(listEnvelopesQuerySchema.safeParse({ externalId: 'a b' }).success).toBe(false);
  });

  it('carries the fields on an upload-mode session only', () => {
    const common = {
      parentOrigin: 'https://app.example.com',
      externalActorId: 'staff-1',
      actions: ['edit'],
    };
    expect(
      createEmbedSessionSchema.safeParse({ ...common, mode: 'upload', externalId: 'r-1' }).success,
    ).toBe(true);
    expect(
      createEmbedSessionSchema.safeParse({
        ...common,
        mode: 'existing',
        envelopeId: '0195f0c0-0000-7000-8000-000000000000',
        externalId: 'r-1',
      }).success,
    ).toBe(false);
  });
});
