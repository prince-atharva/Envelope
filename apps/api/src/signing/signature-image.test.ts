import { createHash } from 'node:crypto';
import { MAX_SIGNATURE_IMAGE_BYTES } from '@envelope/shared';
import { describe, expect, it } from 'vitest';
import { makePng, pngDataUrl } from '../../test/fixtures/png';
import { AppException } from '../common/errors/app-exception';
import { parseSignatureImage } from './signature-image';

function reason(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof AppException) return `${error.code}: ${error.detail}`;
    throw error;
  }
  return 'accepted';
}

describe('parseSignatureImage', () => {
  it('accepts a transparent PNG and reports its size and fingerprint', () => {
    const png = makePng(320, 90);
    const image = parseSignatureImage(pngDataUrl(png));
    expect(image).toMatchObject({ width: 320, height: 90 });
    expect(image.bytes.equals(png)).toBe(true);
    expect(image.sha256).toBe(createHash('sha256').update(png).digest('hex'));
  });

  it('refuses a PNG without transparency', () => {
    expect(reason(() => parseSignatureImage(pngDataUrl(makePng(100, 40, 2))))).toMatch(
      /INVALID_SIGNATURE_IMAGE: .*transparent/,
    );
  });

  it('refuses other formats, even when labelled as PNG', () => {
    expect(reason(() => parseSignatureImage('data:image/jpeg;base64,/9j/4AAQ'))).toMatch(
      /INVALID_SIGNATURE_IMAGE/,
    );
    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(40).fill(0)]);
    expect(
      reason(() => parseSignatureImage(`data:image/png;base64,${jpegBytes.toString('base64')}`)),
    ).toMatch(/not a PNG/);
  });

  it('refuses malformed base64', () => {
    expect(reason(() => parseSignatureImage('data:image/png;base64,abc$'))).toMatch(/base64/);
    expect(reason(() => parseSignatureImage('data:image/png;base64,'))).toMatch(/base64/);
  });

  it('refuses images that are too large or oddly shaped', () => {
    const padded = Buffer.concat([makePng(), Buffer.alloc(MAX_SIGNATURE_IMAGE_BYTES)]);
    expect(reason(() => parseSignatureImage(pngDataUrl(padded)))).toMatch(/larger than/);
    expect(reason(() => parseSignatureImage(pngDataUrl(makePng(5000, 10))))).toMatch(
      /unusual size/,
    );
  });
});
