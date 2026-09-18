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
  template: 'invitation' | 'reminder';
  envelopeId: string;
  recipientId: string;
  requestId?: string;
}

export type EmailJobData = WelcomeEmailJob | SigningLinkEmailJob;
export type EmailTemplate = EmailJobData['template'];

export interface RenderedEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}
