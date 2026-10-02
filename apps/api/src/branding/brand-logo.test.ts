import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { processBrandLogo } from './brand-logo';

async function png(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { r: 20, g: 80, b: 200, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

describe('processBrandLogo', () => {
  it('re-encodes a large PNG to fit inside 480x160', async () => {
    const out = await processBrandLogo(await png(1200, 600));
    expect(out.width).toBeLessThanOrEqual(480);
    expect(out.height).toBeLessThanOrEqual(160);
    expect((await sharp(out.bytes).metadata()).format).toBe('png');
  });

  it('does not enlarge a small logo', async () => {
    const out = await processBrandLogo(await png(100, 40));
    expect(out).toMatchObject({ width: 100, height: 40 });
  });

  it('accepts a JPEG and returns a PNG', async () => {
    const jpeg = await sharp({
      create: { width: 300, height: 100, channels: 3, background: '#336699' },
    })
      .jpeg()
      .toBuffer();
    const out = await processBrandLogo(jpeg);
    expect((await sharp(out.bytes).metadata()).format).toBe('png');
  });

  it('drops metadata from the original', async () => {
    const withExif = await sharp(await png(200, 80))
      .withExif({ IFD0: { Copyright: 'secret-author' } })
      .png()
      .toBuffer();
    const out = await processBrandLogo(withExif);
    const meta = await sharp(out.bytes).metadata();
    expect(meta.exif).toBeUndefined();
    expect(out.bytes.includes(Buffer.from('secret-author'))).toBe(false);
  });

  it('refuses SVG, even when it claims to be an image', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>');
    await expect(processBrandLogo(svg)).rejects.toMatchObject({ code: 'INVALID_BRAND_LOGO' });
  });

  it('refuses a file over 512 KB', async () => {
    const big = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(513 * 1024),
    ]);
    await expect(processBrandLogo(big)).rejects.toMatchObject({ code: 'INVALID_BRAND_LOGO' });
  });

  it('refuses an empty file and a corrupt PNG', async () => {
    await expect(processBrandLogo(Buffer.alloc(0))).rejects.toMatchObject({
      code: 'INVALID_BRAND_LOGO',
    });
    const corrupt = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('not really a png'),
    ]);
    await expect(processBrandLogo(corrupt)).rejects.toMatchObject({ code: 'INVALID_BRAND_LOGO' });
  });

  it('refuses an image that decodes to too many pixels', async () => {
    const huge = await sharp({
      create: { width: 5000, height: 5000, channels: 3, background: '#ffffff' },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(huge.length).toBeLessThan(512 * 1024);
    await expect(processBrandLogo(huge)).rejects.toMatchObject({ code: 'INVALID_BRAND_LOGO' });
  });
});
