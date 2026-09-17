import type { ReactNode } from 'react';

const TONES = {
  error: 'border-red-200 bg-red-50 text-red-800',
  info: 'border-brand-200 bg-brand-50 text-brand-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
} as const;

export function Alert({
  tone = 'error',
  children,
  reference,
}: {
  tone?: keyof typeof TONES;
  children: ReactNode;
  /** Request id shown for unexpected errors, so support can find the logs. */
  reference?: string;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-lg border px-4 py-3 text-sm ${TONES[tone]}`}
    >
      <div>{children}</div>
      {reference && <div className="mt-1 font-mono text-xs opacity-75">Reference: {reference}</div>}
    </div>
  );
}
