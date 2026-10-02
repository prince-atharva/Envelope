import { BRAND_LOGO_FIT, BRAND_LOGO_MAX_BYTES, BRAND_LOGO_MAX_PIXELS } from '@envelope/shared';
import sharp from 'sharp';
import { AppException } from '../common/errors/app-exception';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

function invalid(detail: string): AppException {
  return new AppException('INVALID_BRAND_LOGO', detail);
}

/** What the file's own bytes say it is. The name and the declared type are never trusted (docs/10). */
function looksLikePngOrJpeg(bytes: Buffer): boolean {
  return (
    bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
    bytes.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)
  );
}

export interface BrandLogo {
  bytes: Buffer;
  width: number;
  height: number;
}

/**
 * Turns an uploaded logo into the file that is stored and served (docs/22, ADR 0034).
 *
 * The upload must be a PNG or JPEG by its bytes (never SVG, which can hold script
 * and external references). It is decoded and written out again as a PNG fitted
 * inside 480x160, so nothing from the original, metadata included, is ever served.
 */
export async function processBrandLogo(bytes: Buffer): Promise<BrandLogo> {
  if (bytes.length === 0) throw invalid('Choose an image file.');
  if (bytes.length > BRAND_LOGO_MAX_BYTES) {
    throw invalid(`The logo is larger than ${Math.round(BRAND_LOGO_MAX_BYTES / 1024)} KB.`);
  }
  if (!looksLikePngOrJpeg(bytes)) throw invalid('The logo must be a PNG or JPEG image.');

  try {
    // limitInputPixels makes sharp refuse a small file that decodes to a huge bitmap.
    const source = sharp(bytes, { limitInputPixels: BRAND_LOGO_MAX_PIXELS, failOn: 'error' });
    const meta = await source.metadata();
    if (meta.format !== 'png' && meta.format !== 'jpeg') {
      throw invalid('The logo must be a PNG or JPEG image.');
    }
    const { data, info } = await source
      .rotate()
      .resize({ ...BRAND_LOGO_FIT, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true });
    return { bytes: data, width: info.width, height: info.height };
  } catch (error) {
    if (error instanceof AppException) throw error;
    throw invalid('The logo could not be read. Try exporting it again as a PNG.');
  }
}
