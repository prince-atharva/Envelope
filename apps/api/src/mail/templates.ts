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
export interface SigningLinkEmail {
  kind: 'invitation' | 'reminder';
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

  const subject =
    email.kind === 'invitation'
      ? `${sender} has sent you a document to ${verb}`
      : `Reminder: ${title} awaits your ${email.action === 'approve' ? 'approval' : 'signature'}`;
  const intro =
    email.kind === 'invitation'
      ? `${sender} has sent you "${title}" to ${verb}.`
      : `This is a reminder that ${sender} is waiting for you to ${verb} "${title}".`;
  const replaced =
    email.kind === 'reminder'
      ? 'This email has a new link. Links in earlier emails about this document no longer work.'
      : null;
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
