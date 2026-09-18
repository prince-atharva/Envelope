import { crc32, deflateSync } from 'node:zlib';

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * A real, decodable PNG: a dark diagonal stroke on a transparent background,
 * like a drawn signature. Colour type 6 is RGBA; 2 is RGB with no alpha.
 */
export function makePng(width = 300, height = 100, colourType: 2 | 6 = 6): Buffer {
  const channels = colourType === 6 ? 4 : 3;
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * channels); // filter byte 0, then pixels
    const x = Math.floor((y / height) * width);
    for (let dx = -2; dx <= 2; dx += 1) {
      const px = x + dx;
      if (px < 0 || px >= width) continue;
      const offset = 1 + px * channels;
      row[offset] = 20;
      row[offset + 1] = 30;
      row[offset + 2] = 60;
      if (channels === 4) row[offset + 3] = 255;
    }
    rows.push(row);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = colourType;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function pngDataUrl(png: Buffer = makePng()): string {
  return `data:image/png;base64,${png.toString('base64')}`;
}
