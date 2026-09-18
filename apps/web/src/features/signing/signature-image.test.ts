import { describe, expect, it } from 'vitest';
import { dataUrlBytes, initialsOf, inkBounds } from './signature-image';

/** An RGBA buffer with the given pixels opaque. */
function pixels(width: number, height: number, opaque: [number, number][]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const [x, y] of opaque) data[(y * width + x) * 4 + 3] = 255;
  return data;
}

describe('inkBounds', () => {
  it('is null for a blank canvas', () => {
    expect(inkBounds(pixels(4, 3, []), 4, 3)).toBeNull();
  });

  it('boxes every pixel with any ink, however faint', () => {
    const data = pixels(10, 8, [
      [2, 5],
      [7, 1],
    ]);
    data[(6 * 10 + 4) * 4 + 3] = 1;
    expect(inkBounds(data, 10, 8)).toEqual({ x: 2, y: 1, width: 6, height: 6 });
  });

  it('handles a single pixel in a corner', () => {
    expect(inkBounds(pixels(5, 5, [[4, 4]]), 5, 5)).toEqual({ x: 4, y: 4, width: 1, height: 1 });
  });
});

describe('dataUrlBytes', () => {
  it('counts decoded bytes, allowing for padding', () => {
    expect(dataUrlBytes('data:image/png;base64,AAAA')).toBe(3);
    expect(dataUrlBytes('data:image/png;base64,AAA=')).toBe(2);
    expect(dataUrlBytes('data:image/png;base64,AA==')).toBe(1);
  });
});

describe('initialsOf', () => {
  it('takes the first letter of each name, at most three', () => {
    expect(initialsOf('Priya Sharma')).toBe('PS');
    expect(initialsOf('  raj  ')).toBe('R');
    expect(initialsOf('Anna Maria de la Cruz')).toBe('AMD');
    expect(initialsOf('')).toBe('');
  });

  it('keeps letters outside the Latin alphabet whole', () => {
    expect(initialsOf('Élodie Ōta')).toBe('ÉŌ');
  });
});
