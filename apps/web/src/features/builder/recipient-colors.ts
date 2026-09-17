/**
 * One colour per person, assigned when they are added (docs/09).
 *
 * Every colour here was checked against white: the `text` shade reaches at least
 * 4.5:1 for the name label, and the `border` shade at least 3:1 for the box
 * outline, which is what WCAG 2.2 AA asks for (docs/09, accessibility).
 *
 * Colour is never the only cue. Each field box also carries its recipient's
 * name, so the builder still works for someone who cannot tell two of these
 * apart.
 */
export interface RecipientColor {
  /** Tailwind classes for the field box: translucent fill plus a solid border. */
  box: string;
  /** Tailwind classes for the name label on the box and in the list. */
  label: string;
  /** A plain swatch, for the recipient list. */
  swatch: string;
  name: string;
}

const PALETTE: RecipientColor[] = [
  {
    name: 'teal',
    box: 'border-teal-700 bg-teal-500/15',
    label: 'bg-teal-700 text-white',
    swatch: 'bg-teal-700',
  },
  {
    name: 'indigo',
    box: 'border-indigo-700 bg-indigo-500/15',
    label: 'bg-indigo-700 text-white',
    swatch: 'bg-indigo-700',
  },
  {
    name: 'amber',
    box: 'border-amber-700 bg-amber-500/20',
    label: 'bg-amber-700 text-white',
    swatch: 'bg-amber-700',
  },
  {
    name: 'rose',
    box: 'border-rose-700 bg-rose-500/15',
    label: 'bg-rose-700 text-white',
    swatch: 'bg-rose-700',
  },
  {
    name: 'violet',
    box: 'border-violet-700 bg-violet-500/15',
    label: 'bg-violet-700 text-white',
    swatch: 'bg-violet-700',
  },
  {
    name: 'emerald',
    box: 'border-emerald-700 bg-emerald-500/15',
    label: 'bg-emerald-700 text-white',
    swatch: 'bg-emerald-700',
  },
  {
    name: 'sky',
    box: 'border-sky-700 bg-sky-500/15',
    label: 'bg-sky-700 text-white',
    swatch: 'bg-sky-700',
  },
  {
    name: 'stone',
    box: 'border-stone-600 bg-stone-500/15',
    label: 'bg-stone-600 text-white',
    swatch: 'bg-stone-600',
  },
];

/** Wraps around past the end of the palette rather than running out of colours. */
export function recipientColor(colorIndex: number): RecipientColor {
  const color = PALETTE[colorIndex % PALETTE.length];
  // The index comes from the server and the palette is never empty, but the
  // lookup is still narrowed rather than asserted.
  return color ?? (PALETTE[0] as RecipientColor);
}

export const PALETTE_SIZE = PALETTE.length;
