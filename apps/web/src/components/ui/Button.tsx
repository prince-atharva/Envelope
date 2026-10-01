import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerOutline' | 'success' | 'link';
type Size = 'sm' | 'md' | 'lg' | 'inline';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 disabled:bg-brand-700/60',
  secondary:
    'bg-white text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  ghost: 'text-slate-700 hover:bg-slate-100 disabled:text-slate-400',
  danger: 'bg-red-700 text-white hover:bg-red-800 disabled:bg-red-700/60',
  dangerOutline:
    'bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-red-50 hover:text-red-700 hover:ring-red-200 disabled:text-slate-400',
  success: 'bg-emerald-700 text-white hover:bg-emerald-800 disabled:bg-emerald-700/60',
  link: 'text-brand-700 hover:text-brand-800 hover:underline disabled:text-slate-400',
};

/**
 * Three sizes, because there were none: every screen patched its own padding
 * and font size on top of the base, and no two agreed. `sm` is the dense
 * toolbar button, `md` the default, `lg` the one primary action on a page.
 * `inline` is for the `link` variant, a text action inside a sentence or an
 * empty state.
 */
const SIZES: Record<Size, string> = {
  sm: 'min-h-11 gap-1.5 px-3 py-2 text-sm',
  md: 'min-h-11 gap-2 px-4 py-2.5 text-sm',
  lg: 'min-h-12 gap-2 px-5 py-3 text-base',
  inline: 'min-h-11 gap-1 px-1 text-sm',
};

const BASE =
  'inline-flex items-center justify-center whitespace-nowrap rounded-lg font-semibold transition-colors focus-visible:outline-offset-4 disabled:cursor-not-allowed';

export function buttonClass(variant: Variant = 'primary', extra = '', size: Size = 'md'): string {
  return `${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${extra}`;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className = '',
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type={type}
      className={buttonClass(variant, className, size)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: LinkProps & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, className, size)} {...props} />;
}

/** A square, icon-only action. The label is required: it is the accessible name. */
export function IconButton({
  label,
  tone = 'neutral',
  className = '',
  children,
  type = 'button',
  ...props
}: Omit<ComponentProps<'button'>, 'aria-label'> & {
  label: string;
  tone?: 'neutral' | 'danger';
  children: ReactNode;
}) {
  const hover =
    tone === 'danger'
      ? 'hover:bg-red-50 hover:text-red-700'
      : 'hover:bg-slate-100 hover:text-slate-900';
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-600 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${hover} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
