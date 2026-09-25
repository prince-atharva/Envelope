import type { EnvelopeDetail } from '@envelope/shared';
import { useId } from 'react';
import { Button } from '../../components/ui/Button';
import { formatDateTime } from '../../lib/format';

/**
 * The top of a document on legal hold (docs/17 step 7): overrides cancel,
 * extend and purge until released. Shown to everyone who can see the
 * document; only ADMIN and OWNER can release it (the button is hidden
 * otherwise, by the caller passing no `onRelease`).
 */
export function LegalHoldBanner({
  envelope,
  onRelease,
  releasing,
}: {
  envelope: EnvelopeDetail;
  onRelease?: () => void;
  releasing?: boolean;
}) {
  const headingId = useId();
  if (!envelope.legalHoldAt) return null;

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-2xl border border-purple-200 bg-purple-50/70 p-5 shadow-xs sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="space-y-1">
        <h2 id={headingId} className="font-semibold text-purple-950">
          On legal hold
        </h2>
        <p className="text-sm text-purple-900">
          Placed by {envelope.legalHoldBy?.fullName ?? 'someone in your workspace'} on{' '}
          {formatDateTime(envelope.legalHoldAt)}. Cancelling, extending and retention are all
          blocked until the hold is released.
        </p>
        {envelope.legalHoldReason && (
          <p className="whitespace-pre-line text-sm text-purple-900">
            Reason: "{envelope.legalHoldReason}"
          </p>
        )}
      </div>
      {onRelease && (
        <Button
          variant="secondary"
          onClick={onRelease}
          loading={releasing}
          className="shrink-0 text-xs py-1.5 px-3.5"
        >
          Release hold
        </Button>
      )}
    </section>
  );
}
