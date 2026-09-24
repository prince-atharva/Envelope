import type { EnvelopeDetail } from '@envelope/shared';
import { useId } from 'react';
import { formatDateTime } from '../../lib/format';

/**
 * The top of a completed envelope (docs/15 step 8): sealed, when, and whether
 * everyone has their copy. The fingerprint sits in the page's security card and
 * the download in its action bar, so neither is repeated here.
 */
export function CompletionBanner({ envelope }: { envelope: EnvelopeDetail }) {
  const headingId = useId();
  if (envelope.status !== 'COMPLETED' || !envelope.finalHash) return null;

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-2xl border border-emerald-200/90 bg-emerald-50/80 p-4 sm:p-5 shadow-xs"
    >
      <div className="flex items-start gap-3.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-xs">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
            <path
              d="M5 13l4 4L19 7"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={headingId} className="text-sm sm:text-base font-bold text-slate-900">
              Completed and sealed
            </h2>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 border border-emerald-300/80">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" aria-hidden="true" />
              Locked
            </span>
          </div>
          <p className="mt-1.5 text-xs sm:text-sm text-slate-800 leading-relaxed font-normal">
            {envelope.completedAt
              ? `Everyone signed. Sealed on ${formatDateTime(envelope.completedAt)}, with a certificate page at the back, and locked so it cannot be changed or deleted.`
              : 'Everyone signed. The finished document is sealed and locked.'}
          </p>
          <p className="mt-1 text-xs text-slate-600 font-medium">
            {envelope.senderCopySentAt
              ? `Everyone has been emailed the finished document, including you (${formatDateTime(envelope.senderCopySentAt)}).`
              : 'Everyone is emailed the finished document.'}
          </p>
        </div>
      </div>
    </section>
  );
}
