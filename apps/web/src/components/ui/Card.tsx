import type { ElementType, HTMLAttributes, ReactNode } from 'react';

const PADDING = {
  none: '',
  sm: 'p-4',
  md: 'p-5 sm:p-6',
  lg: 'p-6',
} as const;

const BASE = 'surface';

function cardClass(padding: keyof typeof PADDING = 'md', extra = ''): string {
  return `${BASE} ${PADDING[padding]} ${extra}`.trim();
}

/**
 * The surface every panel sits on. This shell was copy-pasted into eight places
 * and had started to drift a shade and a radius at a time, so screens the
 * sender sees side by side no longer matched.

 */
export function Card({
  as: Tag = 'div',
  padding = 'md',
  className = '',
  children,
  ...props
}: HTMLAttributes<HTMLElement> & {
  as?: ElementType;
  padding?: keyof typeof PADDING;
  children: ReactNode;
}) {
  return (
    <Tag className={cardClass(padding, className)} {...props}>
      {children}
    </Tag>
  );
}
