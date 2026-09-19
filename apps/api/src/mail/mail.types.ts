/** Data stored in Redis for each email job. The job name is the template name. */
export interface WelcomeEmailJob {
  template: 'welcome';
  to: string;
  fullName: string;
  workspaceName: string;
  /** Request that caused the email, so worker logs can be matched to API logs. */
  requestId?: string;
}

/**
 * An email that carries a signing link: the first invitation, or a reminder.
 *
 * Deliberately only ids. The worker reads the rest from the database and mints
 * the link itself at send time, so the raw token is never written to Redis
 * (ADR 0009).
 */
export interface SigningLinkEmailJob {
  /**
   * `extended`: the sender gave more time (docs/16 step 7). `expiry-warning`:
   * the deadline is close (docs/16 step 10).
   */
  template: 'invitation' | 'reminder' | 'extended' | 'expiry-warning';
  envelopeId: string;
  recipientId: string;
  requestId?: string;
}

/** Tells the sender that someone declined. Ids only; the worker reads the rest. */
export interface DeclinedNoticeJob {
  template: 'declined';
  envelopeId: string;
  /** The person who declined. */
  recipientId: string;
  requestId?: string;
}

/**
 * The finished document, to one person (docs/15 step 6). Ids only: the worker
 * reads the sealed file and, for a large one, mints the download link itself.
 */
export interface CompletedEmailJob {
  template: 'completed';
  envelopeId: string;
  /** Null: the sender, who is not a recipient. */
  recipientId: string | null;
  requestId?: string;
}

/**
 * Tells one signer or approver the sender cancelled the envelope (docs/16
 * step 4). Ids only; the worker reads the reason and sends it only to someone
 * who had been emailed.
 */
export interface VoidedNoticeJob {
  template: 'voided';
  envelopeId: string;
  recipientId: string;
  requestId?: string;
}

/** Tells the sender their envelope passed its deadline and is paused (ADR 0013). */
export interface ExpiredNoticeJob {
  template: 'expired';
  envelopeId: string;
  requestId?: string;
}

/** Tells the sender a signer with an expired link asked for more time. */
export interface MoreTimeRequestedJob {
  template: 'more-time-requested';
  envelopeId: string;
  recipientId: string;
  requestId?: string;
}

/** Values an alert may carry: ids, codes and counts, never personal data or secrets. */
export type AlertFields = Record<string, string | number | boolean | null>;

/**
 * An alert raised in the API, emailed by the worker (docs/16 step 11). The
 * worker's own alerts skip the queue and are sent directly.
 */
export interface AlertEmailJob {
  template: 'alert';
  key: string;
  summary: string;
  fields: AlertFields;
  service: string;
  raisedAt: string;
  requestId?: string;
}

export type EmailJobData =
  | WelcomeEmailJob
  | SigningLinkEmailJob
  | DeclinedNoticeJob
  | CompletedEmailJob
  | VoidedNoticeJob
  | ExpiredNoticeJob
  | MoreTimeRequestedJob
  | AlertEmailJob;
export type EmailTemplate = EmailJobData['template'];

export interface EmailAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface RenderedEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
}
