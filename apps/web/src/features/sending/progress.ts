import {
  currentRoutingGroup,
  type EnvelopeStatus,
  isOpenEnvelope,
  nextReminderAt,
  type RecipientDetail,
  type RecipientInfo,
  receivesSigningLink,
  recipientsDueInvitation,
} from '@envelope/shared';

/** Who the send dialog says will be emailed, and when. */
export interface SendSummary {
  /** Emailed as soon as the document is sent. */
  now: RecipientInfo[];
  /** Emailed later, one group after another. */
  later: RecipientInfo[];
  /** Viewers and copy recipients: they get the finished document. */
  copies: RecipientInfo[];
}

export function summariseSend(recipients: RecipientInfo[], sequential: boolean): SendSummary {
  const now = recipientsDueInvitation(recipients, sequential);
  const nowIds = new Set(now.map((recipient) => recipient.id));
  return {
    now,
    later: recipients.filter((r) => receivesSigningLink(r.role) && !nowIds.has(r.id)),
    copies: recipients.filter((r) => !receivesSigningLink(r.role)),
  };
}

export type ProgressTone = 'waiting' | 'active' | 'done' | 'stopped' | 'muted';

export interface Progress {
  label: string;
  tone: ProgressTone;
  /** When the step happened, if it has. */
  at: string | null;
}

/** How far one person has got, as the sender reads it. */
export function progressOf(recipient: RecipientDetail, envelopeStatus: EnvelopeStatus): Progress {
  if (!receivesSigningLink(recipient.role)) {
    return recipient.copySentAt
      ? { label: 'Finished copy sent', tone: 'done', at: recipient.copySentAt }
      : { label: 'Gets the finished copy', tone: 'muted', at: null };
  }
  switch (recipient.status) {
    case 'SIGNED':
      return {
        label: recipient.role === 'APPROVER' ? 'Approved' : 'Signed',
        tone: 'done',
        at: recipient.signedAt,
      };
    case 'DECLINED':
      return { label: 'Declined', tone: 'stopped', at: recipient.declinedAt };
    case 'VIEWED':
      return { label: 'Opened', tone: 'active', at: recipient.viewedAt };
    case 'SENT':
    case 'DELIVERED':
      return recipient.notifiedAt
        ? { label: 'Email sent', tone: 'active', at: recipient.notifiedAt }
        : { label: 'Sending email…', tone: 'active', at: null };
    case 'PENDING':
      return isOpenEnvelope(envelopeStatus)
        ? { label: 'Waiting for their turn', tone: 'waiting', at: null }
        : { label: 'Not reached', tone: 'muted', at: null };
  }
}

export type ReminderState =
  | { can: true }
  | { can: false; reason: 'not-their-turn' | 'finished' | 'closed' }
  | { can: false; reason: 'too-soon'; availableAt: number };

/**
 * Whether the sender may remind this person now. Mirrors the API's rules,
 * including that one after another, a signature not yet stamped into a version
 * keeps the turn: the next person is not invited until it is (docs/15 step 4).
 */
export function reminderState(
  recipient: RecipientDetail,
  everyone: RecipientDetail[],
  envelope: {
    status: EnvelopeStatus;
    sequentialSigning: boolean;
    versions: readonly { createdByRecipientId: string | null }[];
  },
  now = Date.now(),
): ReminderState {
  if (!isOpenEnvelope(envelope.status)) return { can: false, reason: 'closed' };
  if (recipient.status === 'SIGNED' || recipient.status === 'DECLINED') {
    return { can: false, reason: 'finished' };
  }
  const stamped = new Set(
    envelope.versions.flatMap((v) => (v.createdByRecipientId ? [v.createdByRecipientId] : [])),
  );
  const turn = currentRoutingGroup(everyone, envelope.sequentialSigning, stamped);
  if (!turn.some((r) => r.id === recipient.id)) return { can: false, reason: 'not-their-turn' };
  const availableAt = nextReminderAt(recipient);
  if (availableAt > now) return { can: false, reason: 'too-soon', availableAt };
  return { can: true };
}
