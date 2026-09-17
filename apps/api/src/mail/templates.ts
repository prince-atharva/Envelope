import { BRAND } from '@digitalsign/shared';
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

function layout(preheader: string, bodyHtml: string): string {
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
          You received this email because an account was created with this address on ${escapeHtml(BRAND.fullName)}.
          If that was not you, you can ignore this message.
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

  const html = layout(
    `Your workspace ${job.workspaceName} is ready.`,
    `<p style="margin:0 0 16px;">Hi ${escapeHtml(job.fullName)},</p>
     <p style="margin:0 0 16px;">Your workspace <strong>${escapeHtml(job.workspaceName)}</strong> is ready.
     You can now upload documents and prepare them for signing.</p>
     <p style="margin:24px 0;">
       <a href="${escapeHtml(dashboardUrl)}" style="background:${BRAND_COLOR};color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block;font-weight:bold;">Open ${escapeHtml(BRAND.productName)}</a>
     </p>
     <p style="margin:0;color:#6b7785;font-size:13px;">Or copy this link into your browser: ${escapeHtml(dashboardUrl)}</p>`,
  );

  const text = [
    `Hi ${job.fullName},`,
    '',
    `Your workspace "${job.workspaceName}" is ready. You can now upload documents and prepare them for signing.`,
    '',
    `Open ${BRAND.productName}: ${dashboardUrl}`,
    '',
    `You received this email because an account was created with this address on ${BRAND.fullName}.`,
    'If that was not you, you can ignore this message.',
  ].join('\n');

  return { to: job.to, subject, html, text };
}
