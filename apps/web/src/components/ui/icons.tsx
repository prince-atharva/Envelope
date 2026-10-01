/**
 * The handful of small glyphs the screens needed.
 *
 * They existed as emoji (📄 ⚡ ⏳ ⚠️ ✓ ✕ →) dropped into an interface whose
 * every other mark is a stroked SVG. Emoji render as full-colour bitmaps that
 * ignore `currentColor`, differ on every platform, and are read aloud by a
 * screen reader — "warning sign, no fields assigned". These inherit colour and
 * are hidden from the reader, so the sentence beside them carries the meaning.
 */
function Glyph({ d, className = 'h-3.5 w-3.5', strokeWidth = 2 }: IconProps & { d: string }) {
  return (
    <svg
      className={`${className} shrink-0`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

export interface IconProps {
  className?: string;
  strokeWidth?: number;
}

export const DocumentIcon = (props: IconProps) => (
  <Glyph
    {...props}
    d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
  />
);

export const BoltIcon = (props: IconProps) => <Glyph {...props} d="M13 10V3L4 14h7v7l9-11h-7z" />;

export const ClockIcon = (props: IconProps) => (
  <Glyph {...props} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
);

export const WarningIcon = (props: IconProps) => (
  <Glyph
    {...props}
    d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
  />
);

export const CheckIcon = (props: IconProps) => (
  <Glyph {...props} strokeWidth={props.strokeWidth ?? 2.5} d="M5 13l4 4L19 7" />
);

export const CopyIcon = (props: IconProps) => (
  <Glyph
    {...props}
    d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
  />
);

export const CloseIcon = (props: IconProps) => <Glyph {...props} d="M6 18L18 6M6 6l12 12" />;

export const ArrowRightIcon = (props: IconProps) => <Glyph {...props} d="M13 7l5 5-5 5M6 12h12" />;

export const SearchIcon = (props: IconProps) => (
  <Glyph {...props} d="M21 21l-5-5M18 10a8 8 0 11-16 0 8 8 0 0116 0z" />
);
export const MenuIcon = (props: IconProps) => <Glyph {...props} d="M4 6h16M4 12h16M4 18h16" />;
export const ChevronUpIcon = (props: IconProps) => (
  <Glyph {...props} d="M4.5 15.75l7.5-7.5 7.5 7.5" />
);
export const ChevronDownIcon = (props: IconProps) => (
  <Glyph {...props} d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
);
export const TrashIcon = (props: IconProps) => (
  <Glyph
    {...props}
    d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
  />
);
export const SignOutIcon = (props: IconProps) => (
  <Glyph
    {...props}
    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
  />
);
export const UserIcon = (props: IconProps) => (
  <Glyph {...props} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM4 21a8 8 0 0116 0" />
);
