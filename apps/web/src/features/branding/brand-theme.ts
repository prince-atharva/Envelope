import type { CSSProperties } from 'react';

const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

type Rgb = [number, number, number];

function toRgb(hex: string): Rgb {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

/** Moves `hex` toward `target` by `amount` (0 keeps it, 1 is the target). */
function mix(hex: string, target: Rgb, amount: number): string {
  const from = toRgb(hex);
  return toHex(from.map((v, i) => v + ((target[i] ?? 0) - v) * amount) as Rgb);
}

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

/**
 * The accent is the 700 step, the one buttons and links use. The lighter steps tint toward
 * white for backgrounds and borders; the darker ones toward black for hover and pressed.
 */
export function brandShades(accent: string): Record<string, string> {
  return {
    '50': mix(accent, WHITE, 0.92),
    '100': mix(accent, WHITE, 0.84),
    '200': mix(accent, WHITE, 0.68),
    '300': mix(accent, WHITE, 0.5),
    '400': mix(accent, WHITE, 0.32),
    '500': mix(accent, WHITE, 0.15),
    '600': mix(accent, WHITE, 0.07),
    '700': accent,
    '800': mix(accent, BLACK, 0.15),
    '900': mix(accent, BLACK, 0.3),
    '950': mix(accent, BLACK, 0.55),
  };
}

/**
 * Inline custom properties that re-point the `--color-brand-*` theme variables for everything
 * inside an element (docs/22 step 8, ADR 0034). Tailwind's `bg-brand-700` and friends read the
 * variable at run time, so no rebuild is needed. Anything that is not a `#rrggbb` colour gives
 * no override, so the product colour stays.
 */
export function brandStyle(color: string | null | undefined): CSSProperties | undefined {
  if (!color || !HEX_COLOUR.test(color)) return undefined;
  const style: Record<string, string> = {};
  for (const [step, value] of Object.entries(brandShades(color.toLowerCase()))) {
    style[`--color-brand-${step}`] = value;
  }
  return style as CSSProperties;
}
