import type { EnvelopeDetail } from '@envelope/shared';
import { useId } from 'react';
import { formatDateTime } from '../../lib/format';
import { wasDiscarded } from './cancel';

/** The top of a cancelled envelope: who stopped it, when, and the reason people were given. */
export function CancelledBanner({ envelope }: { envelope: EnvelopeDetail }) {
  const headingId = useId();
  if (envelope.status !== 'VOIDED') return null;
  const discarded = wasDiscarded(envelope);
  const who = envelope.voidedBy?.fullName ?? 'Someone in your workspace';
  const when = envelope.voidedAt ? ` on ${formatDateTime(envelope.voidedAt)}` : '';

  return (
    <section
      aria-labelledby={headingId}
      className="space-y-1 rounded-2xl border border-red-200 bg-red-50/70 p-5 shadow-xs"
    >
      <h2 id={headingId} className="font-semibold text-red-950">
        {discarded ? 'Draft discarded' : 'Cancelled'}
      </h2>
      <p className="text-sm text-red-900">
        {discarded
          ? `${who} discarded this draft${when}. It was never sent.`
          : `${who} cancelled this document${when}. Its signing links no longer work.`}
      </p>
      {envelope.voidReason && (
        <p className="whitespace-pre-line text-sm text-red-900">
          Reason given: “{envelope.voidReason}”
        </p>
      )}
    </section>
  );
}
