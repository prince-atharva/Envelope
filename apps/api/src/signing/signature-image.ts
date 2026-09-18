import { createHash } from 'node:crypto';
import {
  MAX_SIGNATURE_IMAGE_BYTES,
  MAX_SIGNATURE_IMAGE_DIMENSION,
  PNG_DATA_URL_PREFIX,
} from '@envelope/shared';
import { AppException } from '../common/errors/app-exception';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
/** PNG colour types that carry an alpha channel: greyscale + alpha, and RGBA. */
const ALPHA_COLOUR_TYPES = new Set([4, 6]);

export interface SignatureImage {
  bytes: Buffer;
  width: number;
  height: number;
  sha256: string;
}

function invalid(detail: string): AppException {
  return new AppException('INVALID_SIGNATURE_IMAGE', detail);
}

/**
 * Checks an adopted signature before it is stored (docs/06, docs/09):
 * a real PNG, with transparency, of a sensible size. Never JPEG, which has no
 * transparency and would put a white box over the document when burned in.
 *
 * Only the header is read; the image is never decoded here.
 */
export function parseSignatureImage(dataUrl: string): SignatureImage {
  if (!dataUrl.startsWith(PNG_DATA_URL_PREFIX)) throw invalid('The image must be a PNG.');
  const encoded = dataUrl.slice(PNG_DATA_URL_PREFIX.length);
  if (encoded.length === 0 || encoded.length % 4 !== 0 || !BASE64.test(encoded)) {
    throw invalid('The image data is not valid base64.');
  }

  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > MAX_SIGNATURE_IMAGE_BYTES) {
    throw invalid(`The image is larger than ${Math.round(MAX_SIGNATURE_IMAGE_BYTES / 1024)} KB.`);
  }
  // Signature (8) + IHDR length (4) + "IHDR" (4) + width (4) + height (4) + depth (1) + colour (1).
  if (bytes.length < 26 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw invalid('The image is not a PNG.');
  }
  if (bytes.toString('latin1', 12, 16) !== 'IHDR') throw invalid('The PNG header is missing.');

  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const colourType = bytes.readUInt8(25);
  if (
    width < 1 ||
    height < 1 ||
    width > MAX_SIGNATURE_IMAGE_DIMENSION ||
    height > MAX_SIGNATURE_IMAGE_DIMENSION
  ) {
    throw invalid('The image is an unusual size.');
  }
  if (!ALPHA_COLOUR_TYPES.has(colourType)) {
    throw invalid('The image must have a transparent background.');
  }

  return { bytes, width, height, sha256: createHash('sha256').update(bytes).digest('hex') };
}
