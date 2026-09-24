import { BRAND } from '@envelope/shared';

export function LogoMark({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="14" className="fill-brand-700" />
      <path
        d="M18 44c6-2 9-10 14-10s4 8 9 8 5-4 7-6"
        fill="none"
        stroke="#ffffff"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M36 14l10 10-14 14H22V28z" className="fill-brand-200" />
    </svg>
  );
}

/** "Envelope" with "Powered by HealthProHub" underneath. */
export function Logo({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const large = size === 'lg';
  return (
    <span className="inline-flex shrink-0 items-center gap-2.5 whitespace-nowrap">
      <LogoMark className={large ? 'h-11 w-11' : 'h-9 w-9'} />
      <span className="flex flex-col justify-center leading-tight">
        <span
          className={`font-semibold tracking-tight text-slate-900 ${large ? 'text-2xl' : 'text-lg'}`}
        >
          {BRAND.productName}
        </span>
        <span className="text-xs font-medium text-brand-700">Powered by {BRAND.companyName}</span>
      </span>
    </span>
  );
}
