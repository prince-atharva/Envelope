import type { EnvelopeDetail } from '@envelope/shared';
import { useId } from 'react';
import { Button } from '../../components/ui/Button';
import { formatDateTime, formatRelative } from '../../lib/format';
import { names } from '../../lib/labels';
import { stillToSign } from './extend';

/**
 * The top of an envelope paused by its deadline (ADR 0013): when it passed,
 * who still has to sign, who asked for more time, and the two ways forward.
 */
export function ExpiredBanner({
  envelope,
  onExtend,
  onCancel,
}: {
  envelope: EnvelopeDetail;
  onExtend: () => void;
  onCancel: () => void;
}) {
  const headingId = useId();
  if (envelope.status !== 'EXPIRED') return null;
  const waiting = stillToSign(envelope.recipients);
  const asked = envelope.recipients.filter((r) => r.moreTimeRequestedAt !== null);
  const deadline = envelope.expiresAt ? formatDateTime(envelope.expiresAt) : null;

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-2xl border border-orange-200 bg-orange-50/70 p-5 shadow-xs sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="space-y-1">
        <h2 id={headingId} className="font-semibold text-orange-950">
          Expired: paused until you give more time
        </h2>
        <p className="text-sm text-orange-900">
          {deadline ? `The deadline passed on ${deadline}` : 'The deadline passed'}
          {waiting.length > 0
            ? ` while ${names(waiting.map((person) => person.name))} still had to sign.`
            : '.'}{' '}
          Signatures already made are kept, but nobody can sign until you give more time.
        </p>
        {asked.map((person) => (
          <p key={person.id} className="text-sm font-medium text-orange-950">
            {person.name} asked for more time{' '}
            {person.moreTimeRequestedAt ? formatRelative(person.moreTimeRequestedAt) : ''}.
          </p>
        ))}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2 max-sm:[&>button]:grow">
        <Button variant="secondary" onClick={onCancel} className="text-xs py-1.5 px-3.5">
          Cancel document
        </Button>
        <Button onClick={onExtend} className="text-xs py-1.5 px-3.5">
          Give more time
        </Button>
      </div>
    </section>
  );
}
