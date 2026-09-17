/** Data stored in Redis for each email job. The job name is the template name. */
export interface WelcomeEmailJob {
  template: 'welcome';
  to: string;
  fullName: string;
  workspaceName: string;
  /** Request that caused the email, so worker logs can be matched to API logs. */
  requestId?: string;
}

export type EmailJobData = WelcomeEmailJob;
export type EmailTemplate = EmailJobData['template'];

export interface RenderedEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}
