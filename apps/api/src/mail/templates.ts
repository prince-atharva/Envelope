import { BRAND } from '@envelope/shared';
import type { RenderedEmail, WelcomeEmailJob } from './mail.types';

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
          <div style="font-size:12px;opacity:0.85;">by ${escapeHtml(BRAND.companyName)}</div>
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

export interface SigningLinkEmail {
  kind: 'invitation' | 'reminder' | 'extended';
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
  const subject = {
    invitation: `${sender} has sent you a document to ${verb}`,
    reminder: `Reminder: ${title} awaits your ${noun}`,
    extended: `More time to ${verb} ${title}`,
  }[email.kind];
  const intro = {
    invitation: `${sender} has sent you "${title}" to ${verb}.`,
    reminder: `This is a reminder that ${sender} is waiting for you to ${verb} "${title}".`,
    extended: `${sender} has given you more time to ${verb} "${title}". Anything you already did is kept.`,
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
  const stem = originalFilename
    .replace(/\.pdf$/i, '')
    .replace(/[^\p{L}\p{N} ._()-]+/gu, '_')
    .trim()
    .slice(0, 120);
  return `${stem || 'document'} (signed).pdf`;
}
