import { BRAND, PASSWORD_RESET_TOKEN_EXPIRY_MINUTES } from '@envelope/shared';
import type { RenderedEmail, TwoFactorNoticeEvent, WelcomeEmailJob } from './mail.types';

/** Brand colour placeholder until HealthProHub supplies its palette (docs/11, week 2). */
const BRAND_COLOR = '#0f766e';

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Every user-supplied value goes through this before it enters an HTML email. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

/** Subject lines and names are single-line; a newline in a header value is an injection risk. */
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0;">
       <a href="${escapeHtml(href)}" style="background:${BRAND_COLOR};color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block;font-weight:bold;">${escapeHtml(label)}</a>
     </p>`;
}

function layout(preheader: string, bodyHtml: string, footer: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(BRAND.fullName)}</title></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1f2933;">
  <span style="display:none;max-height:0;overflow:hidden;">${escapeHtml(preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;">
        <tr><td style="background:${BRAND_COLOR};padding:20px 28px;color:#ffffff;">
          <div style="font-size:20px;font-weight:bold;">${escapeHtml(BRAND.productName)}</div>
          <div style="font-size:12px;opacity:0.85;">Powered by ${escapeHtml(BRAND.companyName)}</div>
        </td></tr>
        <tr><td style="padding:28px;font-size:15px;line-height:1.6;">${bodyHtml}</td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid #e5e9ef;font-size:12px;color:#6b7785;">
          ${escapeHtml(footer)}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function renderWelcomeEmail(job: WelcomeEmailJob, appUrl: string): RenderedEmail {
  const dashboardUrl = new URL('/dashboard', appUrl).toString();
  const subject = `Welcome to ${BRAND.fullName}`;
  const footer =
    `You received this email because an account was created with this address on ${BRAND.fullName}. ` +
    'If that was not you, you can ignore this message.';

  const html = layout(
    `Your workspace ${job.workspaceName} is ready.`,
    `<p style="margin:0 0 16px;">Hi ${escapeHtml(job.fullName)},</p>
     <p style="margin:0 0 16px;">Your workspace <strong>${escapeHtml(job.workspaceName)}</strong> is ready.
     You can now upload documents and prepare them for signing.</p>
     ${button(dashboardUrl, `Open ${BRAND.productName}`)}
     <p style="margin:0;color:#6b7785;font-size:13px;">Or copy this link into your browser: ${escapeHtml(dashboardUrl)}</p>`,
    footer,
  );

  const text = [
    `Hi ${job.fullName},`,
    '',
    `Your workspace "${job.workspaceName}" is ready. You can now upload documents and prepare them for signing.`,
    '',
    `Open ${BRAND.productName}: ${dashboardUrl}`,
    '',
    footer,
  ].join('\n');

  return { to: job.to, subject, html, text };
}

export interface DeclinedNotice {
  to: string;
  senderName: string;
  recipientName: string;
  envelopeTitle: string;
  reason: string;
  envelopeUrl: string;
}

/** To the sender, straight away, when someone declines (docs/09: "the sender is told immediately"). */
export function renderDeclinedEmail(notice: DeclinedNotice): RenderedEmail {
  const who = oneLine(notice.recipientName);
  const title = oneLine(notice.envelopeTitle);
  const subject = `${who} declined ${title}`;
  const intro = `${who} declined to sign "${title}", so it can no longer be signed by anyone.`;
  const footer = `You received this email because you sent this document using ${BRAND.fullName}.`;

  const html = layout(
    intro,
    `<p style="margin:0 0 16px;">Hi ${escapeHtml(oneLine(notice.senderName))},</p>
     <p style="margin:0 0 16px;">${escapeHtml(intro)}</p>
     <p style="margin:0 0 8px;">Their reason:</p>
     <blockquote style="margin:0 0 16px;padding:12px 16px;background:#f4f6f8;border-left:3px solid ${BRAND_COLOR};white-space:pre-line;">${escapeHtml(notice.reason)}</blockquote>
     ${button(notice.envelopeUrl, 'View the document')}`,
    footer,
  );
  const text = [
    `Hi ${oneLine(notice.senderName)},`,
    '',
    intro,
    '',
    'Their reason:',
    notice.reason,
    '',
    `View the document: ${notice.envelopeUrl}`,
    '',
    footer,
  ].join('\n');

  return { to: notice.to, subject, html, text };
}

export interface DelegationNotice {
  to: string;
  /** Who the email is addressed to. */
  name: string;
  audience: 'delegator' | 'sender';
  delegatorName: string;
  delegateName: string;
  envelopeTitle: string;
  envelopeUrl: string;
}

/**
 * Tells the person who passed their part on, or the sender, that it happened
 * (docs/22, ADR 0032). Neither version carries a signing link.
 */
export function renderDelegationNoticeEmail(notice: DelegationNotice): RenderedEmail {
  const from = oneLine(notice.delegatorName);
  const to = oneLine(notice.delegateName);
  const title = oneLine(notice.envelopeTitle);
  const forSender = notice.audience === 'sender';
  const subject = forSender ? `${from} passed ${title} to ${to}` : `You passed ${title} to ${to}`;
  const intro = forSender
    ? `${from} passed their part of "${title}" to ${to}. ${to} has been emailed their own link.`
    : `You passed your part of "${title}" to ${to}. They have been emailed their own link, and the link in your earlier email no longer works.`;
  const footer = forSender
    ? `You received this email because you sent this document using ${BRAND.fullName}.`
    : `You received this email because you passed a document on using ${BRAND.fullName}. If this was not you, contact the sender.`;

  const html = layout(
    intro,
    `<p style="margin:0 0 16px;">Hi ${escapeHtml(oneLine(notice.name))},</p>
     <p style="margin:0 0 16px;">${escapeHtml(intro)}</p>
     ${forSender ? button(notice.envelopeUrl, 'View the document') : ''}`,
    footer,
  );
  const text = [
    `Hi ${oneLine(notice.name)},`,
    '',
    intro,
    ...(forSender ? ['', `View the document: ${notice.envelopeUrl}`] : []),
    '',
    footer,
  ].join('\n');
  return { to: notice.to, subject, html, text };
}

/** Everything an invitation or reminder needs, read by the worker from the database. */
export interface VoidedNotice {
  to: string;
  recipientName: string;
  senderName: string;
  envelopeTitle: string;
  /** The sender's reason, shown as they wrote it. */
  reason: string;
}

/** To someone asked to sign or approve: the sender cancelled. It carries no link. */
export function renderVoidedEmail(notice: VoidedNotice): RenderedEmail {
  const sender = oneLine(notice.senderName);
  const title = oneLine(notice.envelopeTitle);
  const subject = `${sender} cancelled ${title}`;
  const intro = `${sender} cancelled "${title}", so it no longer needs anything from you.`;
  const links = 'Links in earlier emails about this document no longer work.';
  const footer =
    `You received this email because ${sender} had sent you this document using ${BRAND.fullName}. ` +
    `If you have questions, contact ${sender} directly.`;

  const html = layout(
    intro,
    `<p style="margin:0 0 16px;">Hi ${escapeHtml(oneLine(notice.recipientName))},</p>
     <p style="margin:0 0 16px;">${escapeHtml(intro)}</p>
     <p style="margin:0 0 8px;">Their reason:</p>
     <blockquote style="margin:0 0 16px;padding:12px 16px;background:#f4f6f8;border-left:3px solid ${BRAND_COLOR};white-space:pre-line;">${escapeHtml(notice.reason)}</blockquote>
     <p style="margin:0;color:#6b7785;font-size:13px;">${escapeHtml(links)}</p>`,
    footer,
  );
  const text = [
    `Hi ${oneLine(notice.recipientName)},`,
    '',
    intro,
    '',
    'Their reason:',
    notice.reason,
    '',
    links,
    '',
    footer,
  ].join('\n');

  return { to: notice.to, subject, html, text };
}

export interface ExpiredNotice {
  to: string;
  senderName: string;
  envelopeTitle: string;
  deadline: Date;
  /** Signers and approvers who had not finished. */
  waitingFor: string[];
  envelopeUrl: string;
}

/** To the sender: the deadline passed with signatures missing, so it is paused (ADR 0013). */
export function renderExpiredEmail(notice: ExpiredNotice): RenderedEmail {
  const title = oneLine(notice.envelopeTitle);
  const people = notice.waitingFor.map(oneLine);
  const waiting =
    people.length <= 1 ? people.join('') : `${people.slice(0, -1).join(', ')} and ${people.at(-1)}`;
  const subject = `${title} expired before everyone signed`;
  const intro = `"${title}" reached its deadline on ${formatDate(notice.deadline)} while ${waiting || 'someone'} still had to sign.`;
  const paused =
    'Nothing is lost: signatures already made are kept. Nobody can sign until you give more time, or you can cancel it.';
  const footer = `You received this email because you sent this document using ${BRAND.fullName}.`;

  const html = layout(
    intro,
    `<p style="margin:0 0 16px;">Hi ${escapeHtml(oneLine(notice.senderName))},</p>
     <p style="margin:0 0 16px;">${escapeHtml(intro)}</p>
     <p style="margin:0 0 16px;">${escapeHtml(paused)}</p>
     ${button(notice.envelopeUrl, 'Open the document')}`,
    footer,
  );
  const text = [
    `Hi ${oneLine(notice.senderName)},`,
    '',
    intro,
    '',
    paused,
    '',
    `Open the document: ${notice.envelopeUrl}`,
    '',
    footer,
  ].join('\n');

  return { to: notice.to, subject, html, text };
}

export interface MoreTimeNotice {
  to: string;
  senderName: string;
  recipientName: string;
  recipientEmail: string;
  envelopeTitle: string;
  envelopeUrl: string;
}

/** To the sender: someone whose link expired asked for more time (docs/16 step 8). */
export function renderMoreTimeEmail(notice: MoreTimeNotice): RenderedEmail {
  const who = oneLine(notice.recipientName);
  const title = oneLine(notice.envelopeTitle);
  const subject = `${who} asked for more time to sign ${title}`;
  const intro = `${who} (${oneLine(notice.recipientEmail)}) opened "${title}" after its deadline and asked for more time to sign.`;
  const next =
    'Open the document and choose Give more time. They will get a new link, and nothing already signed is lost.';
  const footer = `You received this email because you sent this document using ${BRAND.fullName}.`;

  const html = layout(
    intro,
    `<p style="margin:0 0 16px;">Hi ${escapeHtml(oneLine(notice.senderName))},</p>
     <p style="margin:0 0 16px;">${escapeHtml(intro)}</p>
     <p style="margin:0 0 16px;">${escapeHtml(next)}</p>
     ${button(notice.envelopeUrl, 'Open the document')}`,
    footer,
  );
  const text = [
    `Hi ${oneLine(notice.senderName)},`,
    '',
    intro,
    '',
    next,
    '',
    `Open the document: ${notice.envelopeUrl}`,
    '',
    footer,
  ].join('\n');

  return { to: notice.to, subject, html, text };
}

export interface DeliveryFailedNotice {
  to: string;
  senderName: string;
  recipientName: string;
  recipientEmail: string;
  envelopeTitle: string;
  envelopeUrl: string;
  /** Bounced: the address could not be reached. Complained: they reported it as spam. */
  problem: 'BOUNCED' | 'COMPLAINED';
}

/** To the sender: an email to one of their recipients did not arrive (docs/20, ADR 0029). */
export function renderDeliveryFailedEmail(notice: DeliveryFailedNotice): RenderedEmail {
  const who = oneLine(notice.recipientName);
  const title = oneLine(notice.envelopeTitle);
  const address = oneLine(notice.recipientEmail);
  const subject =
    notice.problem === 'BOUNCED'
      ? `Your email to ${who} about ${title} did not arrive`
      : `${who} reported your email about ${title} as spam`;
  const intro =
    notice.problem === 'BOUNCED'
      ? `The email we sent to ${who} (${address}) about "${title}" could not be delivered, so they may not have their link to sign.`
      : `${who} (${address}) reported the email we sent about "${title}" as spam. They may not see further emails from us.`;
  const next =
    notice.problem === 'BOUNCED'
      ? 'Check that the address is right. If it is wrong, cancel the document and send it again to the correct address. If it is right, ask them to look in their spam folder or to check with their email provider.'
      : 'Contact them another way to make sure they know the document is waiting.';
  const footer = `You received this email because you sent this document using ${BRAND.fullName}.`;

  const html = layout(
    intro,
    `<p style="margin:0 0 16px;">Hi ${escapeHtml(oneLine(notice.senderName))},</p>
     <p style="margin:0 0 16px;">${escapeHtml(intro)}</p>
     <p style="margin:0 0 16px;">${escapeHtml(next)}</p>
     ${button(notice.envelopeUrl, 'Open the document')}`,
    footer,
  );
  const text = [
    `Hi ${oneLine(notice.senderName)},`,
    '',
    intro,
    '',
    next,
    '',
    `Open the document: ${notice.envelopeUrl}`,
    '',
    footer,
  ].join('\n');

  return { to: notice.to, subject, html, text };
}

export interface AlertEmail {
  to: string;
  key: string;
  summary: string;
  /** Ids, codes and counts only. */
  fields: Record<string, string | number | boolean | null>;
  service: string;
  raisedAt: Date;
  appUrl: string;
}

/** To the operator: something needs a person (docs/16 step 11). Plain, for reading on a phone. */
export function renderAlertEmail(alert: AlertEmail): RenderedEmail {
  const summary = oneLine(alert.summary);
  const subject = `[${BRAND.fullName} alert] ${summary}`;
  const rows: [string, string][] = [
    ['Alert', alert.key],
    ['Service', alert.service],
    ['Raised at', `${alert.raisedAt.toISOString()} (UTC)`],
    ['Environment', alert.appUrl],
    ...Object.entries(alert.fields).map(([name, value]): [string, string] => [name, String(value)]),
  ];
  const footer =
    'The same alert is not emailed again for a while; search the logs for alert: true to see every occurrence.';

  const html = layout(
    summary,
    `<p style="margin:0 0 16px;font-weight:600;">${escapeHtml(summary)}</p>
     <table style="border-collapse:collapse;font-size:13px;">${rows
       .map(
         ([name, value]) =>
           `<tr><td style="padding:2px 12px 2px 0;color:#6b7785;">${escapeHtml(name)}</td><td style="padding:2px 0;font-family:monospace;">${escapeHtml(value)}</td></tr>`,
       )
       .join('')}</table>`,
    footer,
  );
  const text = [summary, '', ...rows.map(([name, value]) => `${name}: ${value}`), '', footer].join(
    '\n',
  );
  return { to: alert.to, subject, html, text };
}

export interface SigningLinkEmail {
  kind: 'invitation' | 'reminder' | 'extended' | 'expiry-warning' | 'delegated';
  /** Who passed the document on, for `delegated` (docs/22). */
  delegatorName?: string | null;
  /** For "expires in N days". Defaults to the time of rendering. */
  now?: Date;
  to: string;
  recipientName: string;
  /** Approvers are asked to approve rather than sign. */
  action: 'sign' | 'approve';
  senderName: string;
  envelopeTitle: string;
  message: string | null;
  expiresAt: Date;
  /** Holds the raw token. Rendered into the email and nowhere else. */
  signingUrl: string;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * The invitation and the reminder (docs/09, "Email Templates"): one call to
 * action, the sender's name in the subject, and a plain-text copy. The link is
 * rendered here and nowhere else; no click tracking or link rewriting, so the
 * token never passes through a third party's logs (docs/10).
 */
export function renderSigningLinkEmail(email: SigningLinkEmail): RenderedEmail {
  const sender = oneLine(email.senderName);
  const title = oneLine(email.envelopeTitle);
  const verb = email.action === 'approve' ? 'approve' : 'sign';
  const cta = email.action === 'approve' ? 'Review & Approve' : 'Review & Sign';
  const expires = formatDate(email.expiresAt);

  const noun = email.action === 'approve' ? 'approval' : 'signature';
  const daysLeft = Math.max(
    1,
    Math.round((email.expiresAt.getTime() - (email.now ?? new Date()).getTime()) / 86_400_000),
  );
  const inDays = daysLeft === 1 ? 'in 1 day' : `in ${daysLeft} days`;
  const subject = {
    invitation: `${sender} has sent you a document to ${verb}`,
    reminder: `Reminder: ${title} awaits your ${noun}`,
    extended: `More time to ${verb} ${title}`,
    'expiry-warning': `${title} expires ${inDays}`,
    delegated: `${oneLine(email.delegatorName ?? sender)} passed a document to you to ${verb}`,
  }[email.kind];
  const intro = {
    invitation: `${sender} has sent you "${title}" to ${verb}.`,
    reminder: `This is a reminder that ${sender} is waiting for you to ${verb} "${title}".`,
    extended: `${sender} has given you more time to ${verb} "${title}". Anything you already did is kept.`,
    'expiry-warning': `${sender} is still waiting for your ${noun} on "${title}", and it expires ${inDays}.`,
    delegated: `${oneLine(email.delegatorName ?? 'Someone')} has passed "${title}" to you to ${verb}. It was sent to them by ${sender}.`,
  }[email.kind];
  const replaced =
    email.kind === 'invitation'
      ? null
      : 'This email has a new link. Links in earlier emails about this document no longer work.';
  const footer =
    `You received this email because ${sender} asked you to ${verb} a document using ${BRAND.fullName}. ` +
    'The link is personal to you, so please do not forward this email. ' +
    'If you were not expecting it, you can ignore it.';

  const messageHtml = email.message
    ? `<blockquote style="margin:0 0 16px;padding:12px 16px;background:#f4f6f8;border-left:3px solid ${BRAND_COLOR};white-space:pre-line;">${escapeHtml(email.message)}</blockquote>`
    : '';

  const html = layout(
    intro,
    `<p style="margin:0 0 16px;">Hi ${escapeHtml(oneLine(email.recipientName))},</p>
     <p style="margin:0 0 16px;">${escapeHtml(intro)}</p>
     ${messageHtml}
     ${button(email.signingUrl, cta)}
     <p style="margin:0 0 8px;color:#6b7785;font-size:13px;">This link works until ${escapeHtml(expires)}.</p>
     ${replaced ? `<p style="margin:0 0 8px;color:#6b7785;font-size:13px;">${escapeHtml(replaced)}</p>` : ''}
     <p style="margin:0;color:#6b7785;font-size:13px;">Or copy this link into your browser: ${escapeHtml(email.signingUrl)}</p>`,
    footer,
  );

  const text = [
    `Hi ${oneLine(email.recipientName)},`,
    '',
    intro,
    ...(email.message ? ['', `Message from ${sender}:`, email.message] : []),
    '',
    `${cta}: ${email.signingUrl}`,
    '',
    `This link works until ${expires}.`,
    ...(replaced ? [replaced] : []),
    '',
    footer,
  ].join('\n');

  return { to: email.to, subject, html, text };
}

/** How the finished document reaches the reader: attached, or behind a private link. */
export type CompletedDelivery =
  | { kind: 'attachment'; filename: string }
  | { kind: 'link'; url: string; expiresAt: Date };

/** Everything the completion email needs, read by the worker. */
export interface CompletedEmail {
  to: string;
  name: string;
  /** The sender gets a link to their envelope page as well. */
  isSender: boolean;
  senderName: string;
  envelopeTitle: string;
  /** SHA-256 of the sealed file, as recorded in Envelope.finalHash. */
  sha256: string;
  verifyUrl: string;
  /** Only for the sender. */
  envelopeUrl?: string;
  delivery: CompletedDelivery;
}

/**
 * The completion email (docs/15 step 6): identical document for everyone, with
 * its fingerprint and how to check it. The fingerprint is not in the PDF
 * itself (docs/06, Correction 3), so this email and Verify are where people
 * find it.
 */
export function renderCompletedEmail(email: CompletedEmail): RenderedEmail {
  const title = oneLine(email.envelopeTitle);
  const sender = oneLine(email.senderName);
  const subject = `Completed: ${title}`;
  const intro = email.isSender
    ? `Everyone has signed "${title}". The finished document is sealed and can no longer be changed.`
    : `Everyone has signed "${title}", which ${sender} sent you. The finished document is sealed and can no longer be changed.`;
  const where =
    email.delivery.kind === 'attachment'
      ? `The finished document is attached: ${email.delivery.filename}.`
      : `The finished document is too large to attach. Download it with the button below; the link works until ${formatDate(email.delivery.expiresAt)}.`;
  const check =
    'To check that a copy is exactly the sealed document, upload it on the Verify page, ' +
    'or run "sha256sum" on the file and compare the result with the fingerprint above.';
  const footer =
    `You received this email because you took part in signing this document using ${BRAND.fullName}. ` +
    (email.delivery.kind === 'link'
      ? 'The download link is personal to you, so please do not forward this email.'
      : 'Keep this email: it holds your copy and its fingerprint.');

  const actions =
    email.delivery.kind === 'link'
      ? button(email.delivery.url, 'Download the document')
      : email.envelopeUrl
        ? button(email.envelopeUrl, 'View the envelope')
        : '';

  const html = layout(
    intro,
    `<p style="margin:0 0 16px;">Hi ${escapeHtml(oneLine(email.name))},</p>
     <p style="margin:0 0 16px;">${escapeHtml(intro)}</p>
     <p style="margin:0 0 16px;">${escapeHtml(where)}</p>
     ${actions}
     <p style="margin:0 0 4px;">Fingerprint (SHA-256) of the finished document:</p>
     <p style="margin:0 0 16px;padding:8px 12px;background:#f4f6f8;font-family:Menlo,Consolas,monospace;font-size:12px;word-break:break-all;">${escapeHtml(email.sha256)}</p>
     <p style="margin:0 0 8px;color:#6b7785;font-size:13px;">${escapeHtml(check)}
       <a href="${escapeHtml(email.verifyUrl)}" style="color:${BRAND_COLOR};">Open the Verify page</a>.</p>
     ${
       email.delivery.kind === 'link' && email.envelopeUrl
         ? `<p style="margin:0;color:#6b7785;font-size:13px;"><a href="${escapeHtml(email.envelopeUrl)}" style="color:${BRAND_COLOR};">View the envelope</a></p>`
         : ''
     }`,
    footer,
  );

  const text = [
    `Hi ${oneLine(email.name)},`,
    '',
    intro,
    '',
    where,
    ...(email.delivery.kind === 'link' ? [`Download: ${email.delivery.url}`] : []),
    '',
    'Fingerprint (SHA-256) of the finished document:',
    email.sha256,
    '',
    check,
    `Verify: ${email.verifyUrl}`,
    ...(email.envelopeUrl ? ['', `View the envelope: ${email.envelopeUrl}`] : []),
    '',
    footer,
  ].join('\n');

  return { to: email.to, subject, html, text };
}

/** "Agreement.pdf" becomes "Agreement (signed).pdf", with only safe characters. */
export function signedFilename(originalFilename: string): string {
  return `${safeStem(originalFilename)} (signed).pdf`;
}

/** "Agreement.pdf" becomes "Agreement (certificate).pdf". */
export function certificateFilename(originalFilename: string): string {
  return `${safeStem(originalFilename)} (certificate).pdf`;
}

function safeStem(originalFilename: string): string {
  const stem = originalFilename
    .replace(/\.pdf$/i, '')
    .replace(/[^\p{L}\p{N} ._()-]+/gu, '_')
    .trim()
    .slice(0, 120);
  return stem || 'document';
}

export interface UserInvitedNotice {
  to: string;
  fullName: string;
  invitedByName: string;
  workspaceName: string;
  roleLabel: string;
  acceptUrl: string;
  expiresAt: Date;
}

/** Invited to join a tenant (docs/17 step 6). */
export function renderUserInvitedEmail(notice: UserInvitedNotice): RenderedEmail {
  const inviter = oneLine(notice.invitedByName);
  const workspace = oneLine(notice.workspaceName);
  const subject = `${inviter} invited you to ${workspace} on ${BRAND.fullName}`;
  const intro = `${inviter} invited you to join "${workspace}" as ${notice.roleLabel} on ${BRAND.fullName}.`;
  const expiry = `This invitation expires ${notice.expiresAt.toDateString()}.`;
  const footer = `You received this email because ${inviter} invited you to their workspace.`;

  const html = layout(
    intro,
    `<p style="margin:0 0 16px;">Hi ${escapeHtml(oneLine(notice.fullName))},</p>
     <p style="margin:0 0 16px;">${escapeHtml(intro)}</p>
     ${button(notice.acceptUrl, 'Accept invitation')}
     <p style="margin:0;color:#6b7785;font-size:13px;">${escapeHtml(expiry)}</p>`,
    footer,
  );
  const text = [
    `Hi ${oneLine(notice.fullName)},`,
    '',
    intro,
    '',
    `Accept: ${notice.acceptUrl}`,
    '',
    expiry,
    '',
    footer,
  ].join('\n');

  return { to: notice.to, subject, html, text };
}

export interface WebhookDisabledNotice {
  to: string;
  recipientName: string;
  workspaceName: string;
  /** The hostname only: the path and query of a webhook URL can carry a secret. */
  endpointHost: string;
  failureThreshold: number;
  settingsUrl: string;
}

/** To a workspace admin: an endpoint failed too often and was turned off (docs/18 workstream 9). */
export function renderWebhookDisabledEmail(notice: WebhookDisabledNotice): RenderedEmail {
  const host = oneLine(notice.endpointHost);
  const workspace = oneLine(notice.workspaceName);
  const subject = `Webhook endpoint ${host} was turned off`;
  const intro = `The webhook endpoint at ${host} in "${workspace}" was turned off automatically after ${notice.failureThreshold} deliveries in a row failed every retry.`;
  const impact =
    'Events that happen while it is off are not sent to it. Failed deliveries stay available to retry for seven days.';
  const action =
    'Fix the receiver, then open Settings → Integrations, use Send test event to check it, and reactivate the endpoint.';
  const footer = `You received this email because you are an admin of "${workspace}" on ${BRAND.fullName}.`;

  const html = layout(
    intro,
    `<p style="margin:0 0 16px;">Hi ${escapeHtml(oneLine(notice.recipientName))},</p>
     <p style="margin:0 0 16px;">${escapeHtml(intro)}</p>
     <p style="margin:0 0 16px;">${escapeHtml(impact)}</p>
     <p style="margin:0 0 16px;">${escapeHtml(action)}</p>
     ${button(notice.settingsUrl, 'Open integration settings')}`,
    footer,
  );
  const text = [
    `Hi ${oneLine(notice.recipientName)},`,
    '',
    intro,
    '',
    impact,
    '',
    action,
    '',
    `Open integration settings: ${notice.settingsUrl}`,
    '',
    footer,
  ].join('\n');

  return { to: notice.to, subject, html, text };
}

export interface DownloadRenewedNotice {
  to: string;
  name: string;
  envelopeTitle: string;
  downloadUrl: string;
  expiresAt: Date;
}

/** A fresh link after the old one expired (docs/17 step 10). */
export function renderDownloadRenewedEmail(notice: DownloadRenewedNotice): RenderedEmail {
  const title = oneLine(notice.envelopeTitle);
  const subject = `Your new download link for ${title}`;
  const intro = `Here is a fresh link to download "${title}". The old one had expired.`;
  const expiry = `This link works until ${notice.expiresAt.toDateString()}.`;
  const footer = `You received this email because you took part in signing this document using ${BRAND.fullName}.`;

  const html = layout(
    intro,
    `<p style="margin:0 0 16px;">Hi ${escapeHtml(oneLine(notice.name))},</p>
     <p style="margin:0 0 16px;">${escapeHtml(intro)}</p>
     ${button(notice.downloadUrl, 'Download the document')}
     <p style="margin:0;color:#6b7785;font-size:13px;">${escapeHtml(expiry)}</p>`,
    footer,
  );
  const text = [
    `Hi ${oneLine(notice.name)},`,
    '',
    intro,
    '',
    `Download: ${notice.downloadUrl}`,
    '',
    expiry,
    '',
    footer,
  ].join('\n');

  return { to: notice.to, subject, html, text };
}

export interface PasswordResetNotice {
  to: string;
  fullName: string;
  resetUrl: string;
}

/** The link a person asked for after forgetting their password (docs/19, ADR 0022). */
export function renderPasswordResetEmail(notice: PasswordResetNotice): RenderedEmail {
  const subject = `Reset your ${BRAND.productName} password`;
  const intro = `We received a request to reset the password for your ${BRAND.fullName} account. Use the button below to choose a new password.`;
  const expiry = `This link can be used once and expires in ${PASSWORD_RESET_TOKEN_EXPIRY_MINUTES} minutes. Asking for another link cancels this one.`;
  const footer =
    'If you did not ask for this, you can ignore this email: your password will not change.';

  const html = layout(
    intro,
    `<p style="margin:0 0 16px;">Hi ${escapeHtml(oneLine(notice.fullName))},</p>
     <p style="margin:0 0 16px;">${escapeHtml(intro)}</p>
     ${button(notice.resetUrl, 'Choose a new password')}
     <p style="margin:0;color:#6b7785;font-size:13px;">${escapeHtml(expiry)}</p>`,
    footer,
  );
  const text = [
    `Hi ${oneLine(notice.fullName)},`,
    '',
    intro,
    '',
    `Choose a new password: ${notice.resetUrl}`,
    '',
    expiry,
    '',
    footer,
  ].join('\n');

  return { to: notice.to, subject, html, text };
}

export interface PasswordChangedNotice {
  to: string;
  fullName: string;
  /** The forgot-password page, for someone who did not make the change. */
  resetRequestUrl: string;
  /** A reset signs everything out; a change from the Account page keeps the device that made it. */
  via?: 'reset' | 'change';
}

/** After a reset: the account's password changed and every device was signed out (docs/19). */
export function renderPasswordChangedEmail(notice: PasswordChangedNotice): RenderedEmail {
  const subject = `Your ${BRAND.productName} password was changed`;
  const intro =
    notice.via === 'change'
      ? `The password for your ${BRAND.fullName} account was just changed from its Account page, and every other device that was signed in has been signed out.`
      : `The password for your ${BRAND.fullName} account was just changed, and every device that was signed in has been signed out.`;
  const reassurance = 'If you made this change, you do not need to do anything.';
  const warning = 'If you did not, reset your password now so that only you can sign in:';
  const footer = `You received this email because the password of a ${BRAND.fullName} account with this address was changed.`;

  const html = layout(
    intro,
    `<p style="margin:0 0 16px;">Hi ${escapeHtml(oneLine(notice.fullName))},</p>
     <p style="margin:0 0 16px;">${escapeHtml(intro)}</p>
     <p style="margin:0 0 16px;">${escapeHtml(reassurance)}</p>
     <p style="margin:0;">${escapeHtml(warning)}</p>
     ${button(notice.resetRequestUrl, 'Reset my password')}`,
    footer,
  );
  const text = [
    `Hi ${oneLine(notice.fullName)},`,
    '',
    intro,
    '',
    reassurance,
    `${warning} ${notice.resetRequestUrl}`,
    '',
    footer,
  ].join('\n');

  return { to: notice.to, subject, html, text };
}

export interface TwoFactorNotice {
  to: string;
  fullName: string;
  event: TwoFactorNoticeEvent;
  /** Only for `recovery-used`: how many single-use codes are still unused. */
  recoveryCodesLeft?: number;
  /** The forgot-password page, for someone who did not do it themselves. */
  resetRequestUrl: string;
}

/** Two-factor was turned on or off, a recovery code was used, or an Owner reset it (docs/19). */
export function renderTwoFactorNoticeEmail(notice: TwoFactorNotice): RenderedEmail {
  const account = `your ${BRAND.fullName} account`;
  const copy: Record<TwoFactorNoticeEvent, { subject: string; intro: string }> = {
    enabled: {
      subject: 'Two-factor authentication was turned on',
      intro: `Two-factor authentication was turned on for ${account}. From now on, signing in asks for a code from your authenticator app.`,
    },
    disabled: {
      subject: 'Two-factor authentication was turned off',
      intro: `Two-factor authentication was turned off for ${account}, and every other device that was signed in has been signed out.`,
    },
    'recovery-used': {
      subject: 'A recovery code was used to sign in',
      intro: `A recovery code was used to sign in to ${account}.${
        notice.recoveryCodesLeft === undefined
          ? ''
          : ` You have ${notice.recoveryCodesLeft} unused recovery ${
              notice.recoveryCodesLeft === 1 ? 'code' : 'codes'
            } left.`
      }`,
    },
    'reset-by-owner': {
      subject: 'Your two-factor authentication was reset',
      intro: `An owner of your workspace reset two-factor authentication on ${account}, and you were signed out. If your workspace requires it, you will set it up again the next time you sign in.`,
    },
  };
  const { subject, intro } = copy[notice.event];
  const warning =
    notice.event === 'reset-by-owner'
      ? 'If you did not expect this, ask the owner of your workspace.'
      : 'If this was not you, reset your password now so that only you can sign in:';
  const footer = `You received this email because of a change to the security of a ${BRAND.fullName} account with this address.`;

  const action =
    notice.event === 'reset-by-owner' ? '' : button(notice.resetRequestUrl, 'Reset my password');
  const html = layout(
    intro,
    `<p style="margin:0 0 16px;">Hi ${escapeHtml(oneLine(notice.fullName))},</p>
     <p style="margin:0 0 16px;">${escapeHtml(intro)}</p>
     <p style="margin:0;">${escapeHtml(warning)}</p>
     ${action}`,
    footer,
  );
  const text = [
    `Hi ${oneLine(notice.fullName)},`,
    '',
    intro,
    '',
    notice.event === 'reset-by-owner' ? warning : `${warning} ${notice.resetRequestUrl}`,
    '',
    footer,
  ].join('\n');

  return { to: notice.to, subject, html, text };
}
