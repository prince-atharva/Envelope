import { BRAND } from '@envelope/shared';

interface AppFooterProps {
  className?: string;
}

/** The product name and tagline, at the foot of each page. */
export function AppFooter({ className = '' }: AppFooterProps) {
  return (
    <footer
      className={`mt-auto border-t border-slate-200/60 py-3 text-center text-xs text-slate-500 ${className}`}
    >
      <div className="mx-auto flex flex-wrap items-center justify-center gap-1.5 px-4">
        <span className="font-medium text-slate-700">{BRAND.fullName}</span>
        <span className="text-slate-300" aria-hidden="true">
          •
        </span>
        <span className="text-slate-500">{BRAND.tagline}</span>
      </div>
    </footer>
  );
}
