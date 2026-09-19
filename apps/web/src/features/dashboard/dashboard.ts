import type {
  AttentionReason,
  EnvelopeCounts,
  EnvelopeProgress,
  EnvelopeView,
} from '@envelope/shared';
import { ENVELOPE_VIEWS } from '@envelope/shared';
import { formatRelative } from '../../lib/format';

/** The dashboard's tabs, in order (docs/16 step 14). */
export const VIEW_LABELS: Record<EnvelopeView, string> = {
  attention: 'Needs attention',
  waiting: 'Waiting',
  completed: 'Completed',
  cancelled: 'Cancelled',
  drafts: 'Drafts',
  all: 'All',
};

export function isView(value: string | null): value is EnvelopeView {
  return value !== null && (ENVELOPE_VIEWS as readonly string[]).includes(value);
}

/** The dashboard opens on Needs attention when anything needs it, otherwise All. */
export function defaultView(counts: EnvelopeCounts | undefined): EnvelopeView {
  return counts && counts.attention > 0 ? 'attention' : 'all';
}

/** Why a document is in Needs attention, as the sender reads it. */
export function describeAttention(
  attention: { reason: AttentionReason; since: string },
  now = Date.now(),
): string {
  const when = formatRelative(attention.since, now);
  switch (attention.reason) {
    case 'EXPIRED':
      return `Expired ${when}: give more time or cancel`;
    case 'NOT_OPENED':
      return `Not opened since it was sent ${when}`;
    case 'EMAIL_NOT_DELIVERED':
      return `Email not delivered, sent ${when}`;
    case 'EXPIRING_SOON':
      return `Expires ${when}`;
    case 'DECLINED':
      return `Declined ${when}`;
  }
}

/** "2 of 3 signed · Waiting on Priya" */
export function describeProgress(progress: EnvelopeProgress): string {
  const parts = [`${progress.signed} of ${progress.total} signed`];
  if (progress.waitingOn.length === 1) parts.push(`Waiting on ${progress.waitingOn[0]}`);
  if (progress.waitingOn.length > 1) {
    parts.push(`Waiting on ${progress.waitingOn[0]} and ${progress.waitingOn.length - 1} more`);
  }
  return parts.join(' · ');
}
