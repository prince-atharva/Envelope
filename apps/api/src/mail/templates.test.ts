import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  renderAlertEmail,
  renderCompletedEmail,
  renderDeclinedEmail,
  renderDelegationNoticeEmail,
  renderDeliveryFailedEmail,
  renderExpiredEmail,
  renderMoreTimeEmail,
  renderPasswordChangedEmail,
  renderPasswordResetEmail,
  renderSigningLinkEmail,
  renderTwoFactorNoticeEmail,
  renderVoidedEmail,
  renderWebhookDisabledEmail,
  renderWelcomeEmail,
  signedFilename,
} from './templates';

describe('signing-link emails', () => {
  const url = `https://sign.example.com/sign/${'a'.repeat(64)}`;
  const base = {
    kind: 'invitation' as const,
    to: 'priya@example.com',
    recipientName: 'Priya Sharma',
    action: 'sign' as const,
    senderName: 'Raj Kumar',
    envelopeTitle: 'Lease <2026>',
    message: 'Please sign by Friday.\nThanks!',
    expiresAt: new Date('2026-10-02T09:00:00Z'),
    signingUrl: url,
  };

  it('invites with the sender in the subject and one call to action', () => {
    const email = renderSigningLinkEmail(base);
    expect(email.subject).toBe('Raj Kumar has sent you a document to sign');
    expect(email.html).toContain(`href="${url}"`);
    expect(email.html.match(/<a /g)).toHaveLength(1);
    expect(email.html).toContain('Review &amp; Sign');
    expect(email.text).toContain(`Review & Sign: ${url}`);
    expect(email.text).toContain('This link works until 2 October 2026.');
  });

  it('says more time was given, with the new deadline, and that the old link is dead', () => {
    const email = renderSigningLinkEmail({ ...base, kind: 'extended' });
    expect(email.subject).toBe('More time to sign Lease <2026>');
    expect(email.text).toContain('Raj Kumar has given you more time to sign "Lease <2026>".');
    expect(email.text).toContain('This link works until 2 October 2026.');
    expect(email.text).toContain('Links in earlier emails about this document no longer work.');
  });

  it('warns before the deadline, counting the days left', () => {
    const now = new Date('2026-09-30T09:00:00Z');
    const email = renderSigningLinkEmail({ ...base, kind: 'expiry-warning', now });
    expect(email.subject).toBe('Lease <2026> expires in 2 days');
    expect(email.text).toContain(
      'Raj Kumar is still waiting for your signature on "Lease <2026>", and it expires in 2 days.',
    );
    const lastDay = renderSigningLinkEmail({
      ...base,
      kind: 'expiry-warning',
      now: new Date('2026-10-01T20:00:00Z'),
    });
    expect(lastDay.subject).toBe('Lease <2026> expires in 1 day');
  });

  it('includes the sender message, escaped in HTML and as typed in text', () => {
    const email = renderSigningLinkEmail({ ...base, message: '<b>Hi</b> & thanks' });
    expect(email.html).toContain('&lt;b&gt;Hi&lt;/b&gt; &amp; thanks');
    expect(email.text).toContain('Message from Raj Kumar:\n<b>Hi</b> & thanks');
    expect(renderSigningLinkEmail({ ...base, message: null }).text).not.toContain('Message from');
  });

  it('escapes the title and never lets a name break the subject line', () => {
    const email = renderSigningLinkEmail({
      ...base,
      kind: 'reminder',
      envelopeTitle: 'Lease\r\nBcc: attacker@example.com',
    });
    expect(email.subject).toBe('Reminder: Lease Bcc: attacker@example.com awaits your signature');
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(renderSigningLinkEmail(base).html).toContain('Lease &lt;2026&gt;');
  });

  it('tells a reminder recipient that older links stopped working', () => {
    const email = renderSigningLinkEmail({ ...base, kind: 'reminder' });
    expect(email.subject).toBe('Reminder: Lease <2026> awaits your signature');
    expect(email.text).toContain('Links in earlier emails about this document no longer work.');
  });

  it('tells a delegate who passed the document on, and carries their own link', () => {
    const email = renderSigningLinkEmail({ ...base, kind: 'delegated', delegatorName: 'Asha Rao' });
    expect(email.subject).toBe('Asha Rao passed a document to you to sign');
    expect(email.text).toContain('Asha Rao has passed "Lease <2026>" to you to sign');
    expect(email.text).toContain(url);
  });

  it('asks an approver to approve', () => {
    const email = renderSigningLinkEmail({ ...base, action: 'approve' });
    expect(email.subject).toBe('Raj Kumar has sent you a document to approve');
    expect(email.html).toContain('Review &amp; Approve');
  });
});

describe('declined notice', () => {
  it('tells the sender who declined, why, and where to look', () => {
    const email = renderDeclinedEmail({
      to: 'raj@example.com',
      senderName: 'Raj Kumar',
      recipientName: 'Priya Sharma',
      envelopeTitle: 'Lease',
      reason: 'The fee is <wrong>.',
      envelopeUrl: 'https://sign.example.com/dashboard/envelopes/e-1',
    });
    expect(email.subject).toBe('Priya Sharma declined Lease');
    expect(email.html).toContain('The fee is &lt;wrong&gt;.');
    expect(email.text).toContain('Their reason:\nThe fee is <wrong>.');
    expect(email.html).toContain('href="https://sign.example.com/dashboard/envelopes/e-1"');
  });
});

describe('cancellation notice', () => {
  it('tells a signer who cancelled and why, and carries no link', () => {
    const email = renderVoidedEmail({
      to: 'priya@example.com',
      recipientName: 'Priya Sharma',
      senderName: 'Raj Kumar',
      envelopeTitle: 'Lease\nrenewal',
      reason: 'Terms <changed>.',
    });
    expect(email.to).toBe('priya@example.com');
    // A title cannot add lines to the subject.
    expect(email.subject).toBe('Raj Kumar cancelled Lease renewal');
    expect(email.html).toContain('Terms &lt;changed&gt;.');
    expect(email.text).toContain('Their reason:\nTerms <changed>.');
    expect(email.text).toContain('Links in earlier emails about this document no longer work.');
    expect(email.html).not.toContain('href=');
  });
});

describe('expiry notice', () => {
  it('tells the sender who is still to sign, that nothing is lost, and where to act', () => {
    const email = renderExpiredEmail({
      to: 'raj@example.com',
      senderName: 'Raj Kumar',
      envelopeTitle: 'Lease',
      deadline: new Date('2026-10-01T09:00:00Z'),
      waitingFor: ['Priya Sharma', 'Dev <Rao>'],
      envelopeUrl: 'https://sign.example.com/dashboard/envelopes/e-1',
    });
    expect(email.subject).toBe('Lease expired before everyone signed');
    expect(email.text).toContain(
      '1 October 2026 while Priya Sharma and Dev <Rao> still had to sign',
    );
    expect(email.html).toContain('Dev &lt;Rao&gt;');
    expect(email.text).toContain('signatures already made are kept');
    expect(email.html).toContain('href="https://sign.example.com/dashboard/envelopes/e-1"');
  });
});

describe('more-time notice', () => {
  it('names who asked, with their address, and where to give more time', () => {
    const email = renderMoreTimeEmail({
      to: 'raj@example.com',
      senderName: 'Raj Kumar',
      recipientName: 'Priya\nSharma',
      recipientEmail: 'priya@example.com',
      envelopeTitle: 'Lease',
      envelopeUrl: 'https://sign.example.com/dashboard/envelopes/e-1',
    });
    expect(email.subject).toBe('Priya Sharma asked for more time to sign Lease');
    expect(email.text).toContain(
      'Priya Sharma (priya@example.com) opened "Lease" after its deadline',
    );
    expect(email.html).toContain('href="https://sign.example.com/dashboard/envelopes/e-1"');
  });
});

describe('delivery-failed notice', () => {
  const base = {
    to: 'raj@example.com',
    senderName: 'Raj Kumar',
    recipientName: 'Priya\nSharma',
    recipientEmail: 'priya@example.com',
    envelopeTitle: 'Lease',
    envelopeUrl: 'https://sign.example.com/dashboard/envelopes/e-1',
  };

  it('says which address could not be reached and what to do about it', () => {
    const email = renderDeliveryFailedEmail({ ...base, problem: 'BOUNCED' });
    expect(email.subject).toBe('Your email to Priya Sharma about Lease did not arrive');
    expect(email.text).toContain(
      'Priya Sharma (priya@example.com) about "Lease" could not be delivered',
    );
    expect(email.text).toContain('cancel the document and send it again');
    expect(email.html).toContain('href="https://sign.example.com/dashboard/envelopes/e-1"');
  });

  it('reads differently when the recipient reported it as spam, and escapes names', () => {
    const email = renderDeliveryFailedEmail({
      ...base,
      recipientName: 'Dev <Rao>',
      problem: 'COMPLAINED',
    });
    expect(email.subject).toBe('Dev <Rao> reported your email about Lease as spam');
    expect(email.html).toContain('Dev &lt;Rao&gt;');
    expect(email.text).toContain('Contact them another way');
  });
});

describe('alert email', () => {
  it('lists the key, the service, the time and the ids, escaped', () => {
    const email = renderAlertEmail({
      to: 'ops@example.com',
      key: 'seal-job-failed',
      summary: 'Seal job failed permanently',
      fields: { envelopeId: 'e-1', attemptsMade: 5, note: '<b>' },
      service: 'worker',
      raisedAt: new Date('2026-09-19T12:00:00Z'),
      appUrl: 'https://sign.example.com',
    });
    expect(email.subject).toBe(
      '[Envelope powered by HealthProHub alert] Seal job failed permanently',
    );
    expect(email.text).toContain('Alert: seal-job-failed');
    expect(email.text).toContain('Service: worker');
    expect(email.text).toContain('Raised at: 2026-09-19T12:00:00.000Z (UTC)');
    expect(email.text).toContain('attemptsMade: 5');
    expect(email.html).toContain('&lt;b&gt;');
  });
});

describe('welcome email', () => {
  const job = {
    template: 'welcome' as const,
    to: 'raj@example.com',
    fullName: 'Raj <script>alert(1)</script> Kumar',
    workspaceName: 'Sunrise & Co "Clinic"',
  };

  it('is branded and links to the dashboard', () => {
    const email = renderWelcomeEmail(job, 'https://sign.example.com');
    expect(email.to).toBe('raj@example.com');
    expect(email.subject).toBe('Welcome to Envelope powered by HealthProHub');
    expect(email.html).toContain('href="https://sign.example.com/dashboard"');
    expect(email.text).toContain('Open Envelope: https://sign.example.com/dashboard');
    expect(email.html).toContain('Powered by HealthProHub');
  });

  it('escapes every user-supplied value in the HTML part', () => {
    const { html, text } = renderWelcomeEmail(job, 'https://sign.example.com');
    expect(html).not.toContain('<script>');
    expect(html).toContain('Raj &lt;script&gt;alert(1)&lt;/script&gt; Kumar');
    expect(html).toContain('Sunrise &amp; Co &quot;Clinic&quot;');
    // The plain-text part is not HTML and keeps the values as typed.
    expect(text).toContain('Hi Raj <script>alert(1)</script> Kumar,');
  });

  it('keeps its own footer', () => {
    const { html } = renderWelcomeEmail(job, 'https://sign.example.com');
    expect(html).toContain('an account was created with this address');
  });

  it('escapes all five HTML special characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });
});

describe('completion emails', () => {
  const sha256 = 'ab'.repeat(32);
  const base = {
    to: 'priya@example.com',
    name: 'Priya <Sharma>',
    isSender: false,
    senderName: 'Raj Kumar',
    envelopeTitle: 'Lease <2026>',
    sha256,
    verifyUrl: 'https://sign.example.com/verify',
    delivery: { kind: 'attachment' as const, filename: 'Lease (signed).pdf' },
  };

  it('says the document is attached and gives its fingerprint and how to check it', () => {
    const email = renderCompletedEmail(base);
    expect(email.subject).toBe('Completed: Lease <2026>');
    expect(email.html).toContain('Lease &lt;2026&gt;');
    expect(email.html).toContain('Priya &lt;Sharma&gt;');
    expect(email.html).not.toContain('<Sharma>');
    expect(email.html).toContain(sha256);
    expect(email.html).toContain('href="https://sign.example.com/verify"');
    expect(email.text).toContain('The finished document is attached: Lease (signed).pdf.');
    expect(email.text).toContain(`${sha256}\n`);
    expect(email.text).toContain('sha256sum');
    expect(email.text).toContain('which Raj Kumar sent you');
    expect(email.text).not.toContain('View the envelope');
  });

  it('gives a large document as a download link with its end date', () => {
    const url = `https://sign.example.com/api/v1/download/${'d'.repeat(64)}`;
    const email = renderCompletedEmail({
      ...base,
      delivery: { kind: 'link', url, expiresAt: new Date('2026-10-19T12:00:00Z') },
    });
    expect(email.html).toContain(`href="${url}"`);
    expect(email.html).toContain('Download the document');
    expect(email.text).toContain(`Download: ${url}`);
    expect(email.text).toContain('the link works until 19 October 2026');
    expect(email.text).toContain('please do not forward this email');
  });

  it('gives the sender a link to their envelope', () => {
    const email = renderCompletedEmail({
      ...base,
      isSender: true,
      envelopeUrl: 'https://sign.example.com/dashboard/envelopes/e1',
    });
    expect(email.text).toContain('Everyone has signed "Lease <2026>".');
    expect(email.html).toContain('href="https://sign.example.com/dashboard/envelopes/e1"');
    expect(email.text).toContain(
      'View the envelope: https://sign.example.com/dashboard/envelopes/e1',
    );
  });

  it('names the attachment after the original file, with only safe characters', () => {
    expect(signedFilename('Lease 2026.pdf')).toBe('Lease 2026 (signed).pdf');
    expect(signedFilename('Øresund "draft"/v2.PDF')).toBe('Øresund _draft_v2 (signed).pdf');
    expect(signedFilename('.pdf')).toBe('document (signed).pdf');
  });
});

describe('webhook disabled notice', () => {
  const notice = {
    to: 'admin@example.com',
    recipientName: 'Ada <Admin>',
    workspaceName: 'Riverside\nClinic',
    endpointHost: 'hooks.partner.example',
    failureThreshold: 10,
    settingsUrl: 'https://app.example.com/settings/integrations',
  };

  it('names the host and threshold, points to the settings, and stays on one subject line', () => {
    const email = renderWebhookDisabledEmail(notice);
    expect(email.to).toBe('admin@example.com');
    expect(email.subject).toBe('Webhook endpoint hooks.partner.example was turned off');
    expect(email.text).toContain('after 10 deliveries in a row failed every retry');
    expect(email.text).toContain('Riverside Clinic');
    expect(email.text).toContain(
      'Open integration settings: https://app.example.com/settings/integrations',
    );
    expect(email.html).toContain('href="https://app.example.com/settings/integrations"');
    expect(email.html).toContain('Ada &lt;Admin&gt;');
    expect(email.html.match(/<a /g)).toHaveLength(1);
  });
});

describe('password-reset email', () => {
  const resetUrl = `https://app.example.com/reset-password/${'d'.repeat(64)}`;
  const notice = { to: 'asha@example.com', fullName: 'Asha <Rao>\nJr', resetUrl };

  it('has one call to action, says it works once and for an hour, and says what to do if unasked', () => {
    const email = renderPasswordResetEmail(notice);
    expect(email.to).toBe('asha@example.com');
    expect(email.subject).toBe('Reset your Envelope password');
    expect(email.text).toContain(`Choose a new password: ${resetUrl}`);
    expect(email.text).toContain('can be used once and expires in 60 minutes');
    expect(email.text).toContain('you can ignore this email');
    expect(email.html).toContain(`href="${resetUrl}"`);
    expect(email.html.match(/<a /g)).toHaveLength(1);
  });

  it('escapes the name in HTML and keeps it on one line in text', () => {
    const email = renderPasswordResetEmail(notice);
    expect(email.html).toContain('Asha &lt;Rao&gt; Jr');
    expect(email.text).toContain('Hi Asha <Rao> Jr,');
  });
});

describe('password-changed email', () => {
  const resetRequestUrl = 'https://app.example.com/forgot-password';

  it('says every device was signed out and offers one way back for someone who did not do it', () => {
    const email = renderPasswordChangedEmail({
      to: 'asha@example.com',
      fullName: 'Asha <Rao>',
      resetRequestUrl,
    });
    expect(email.subject).toBe('Your Envelope password was changed');
    expect(email.text).toContain('every device that was signed in has been signed out');
    expect(email.text).toContain(`If you did not, reset your password now`);
    expect(email.text).toContain(resetRequestUrl);
    expect(email.html).toContain(`href="${resetRequestUrl}"`);
    expect(email.html).toContain('Asha &lt;Rao&gt;');
    expect(email.html.match(/<a /g)).toHaveLength(1);
  });

  it('says every OTHER device was signed out when the change came from the Account page', () => {
    const email = renderPasswordChangedEmail({
      to: 'asha@example.com',
      fullName: 'Asha Rao',
      resetRequestUrl,
      via: 'change',
    });
    expect(email.text).toContain('from its Account page');
    expect(email.text).toContain('every other device that was signed in has been signed out');
  });
});

describe('two-factor notice emails', () => {
  const base = {
    to: 'asha@example.com',
    fullName: 'Asha <Rao>',
    resetRequestUrl: 'https://app.example.com/forgot-password',
  };

  it.each([
    ['enabled', 'Two-factor authentication was turned on', 'a code from your authenticator app'],
    ['disabled', 'Two-factor authentication was turned off', 'every other device'],
    ['recovery-used', 'A recovery code was used to sign in', 'A recovery code was used'],
  ] as const)(
    'says what happened for %s, with a way back for someone who did not do it',
    (event, subject, phrase) => {
      const email = renderTwoFactorNoticeEmail({ ...base, event });
      expect(email.subject).toBe(subject);
      expect(email.text).toContain(phrase);
      expect(email.text).toContain('https://app.example.com/forgot-password');
      expect(email.html).toContain('Asha &lt;Rao&gt;');
      expect(email.html.match(/<a /g)).toHaveLength(1);
    },
  );

  it('says how many recovery codes are left, in the singular too', () => {
    expect(
      renderTwoFactorNoticeEmail({ ...base, event: 'recovery-used', recoveryCodesLeft: 7 }).text,
    ).toContain('You have 7 unused recovery codes left.');
    expect(
      renderTwoFactorNoticeEmail({ ...base, event: 'recovery-used', recoveryCodesLeft: 1 }).text,
    ).toContain('You have 1 unused recovery code left.');
  });

  it('tells someone an owner reset their factor, and does not send them to reset a password', () => {
    const email = renderTwoFactorNoticeEmail({ ...base, event: 'reset-by-owner' });
    expect(email.subject).toBe('Your two-factor authentication was reset');
    expect(email.text).toContain('ask the owner of your workspace');
    expect(email.html).not.toContain('<a ');
  });
});

describe('delegation notice', () => {
  const base = {
    name: 'Raj Kumar',
    delegatorName: 'Asha Rao',
    delegateName: 'Sam <Lee>',
    envelopeTitle: 'Lease',
    envelopeUrl: 'https://app.example.com/dashboard/envelopes/abc',
  };

  it('tells the sender who passed it to whom, and where to look, with no signing link', () => {
    const email = renderDelegationNoticeEmail({
      ...base,
      to: 'raj@example.com',
      audience: 'sender',
    });
    expect(email.subject).toBe('Asha Rao passed Lease to Sam <Lee>');
    expect(email.text).toContain(
      'View the document: https://app.example.com/dashboard/envelopes/abc',
    );
    expect(email.html).toContain('Sam &lt;Lee&gt;');
    expect(email.text).not.toContain('/sign/');
  });

  it('tells the person who passed it on that their old link no longer works', () => {
    const email = renderDelegationNoticeEmail({
      ...base,
      name: 'Asha Rao',
      to: 'asha@example.com',
      audience: 'delegator',
    });
    expect(email.subject).toBe('You passed Lease to Sam <Lee>');
    expect(email.text).toContain('no longer works');
    expect(email.text).not.toContain('View the document');
  });
});

describe('workspace branding in recipient emails (docs/22, ADR 0034)', () => {
  const signing = {
    kind: 'invitation' as const,
    to: 'priya@example.com',
    recipientName: 'Priya Sharma',
    action: 'sign' as const,
    senderName: 'Raj Kumar',
    envelopeTitle: 'Lease',
    message: 'Please sign.',
    expiresAt: new Date('2026-10-20T00:00:00Z'),
    signingUrl: `https://sign.example.com/sign/${'a'.repeat(64)}`,
  };
  const brand = {
    name: 'Acme <Clinic>',
    color: '#1d4ed8',
    logoUrl: 'https://app.example.com/api/v1/branding/logo/abc123',
  };

  it('keeps the product look when no brand is given', () => {
    const { html } = renderSigningLinkEmail(signing);
    expect(html).toContain('#0f766e');
    expect(html).toContain('Powered by HealthProHub');
    expect(html).not.toContain('<img');
  });

  it('uses the accent colour for the header, the button and the quoted message', () => {
    const { html } = renderSigningLinkEmail({ ...signing, brand });
    expect(html).not.toContain('#0f766e');
    expect(html.match(/#1d4ed8/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('shows the logo with the workspace name as its text alternative, escaped', () => {
    const { html } = renderSigningLinkEmail({ ...signing, brand });
    expect(html).toContain('src="https://app.example.com/api/v1/branding/logo/abc123"');
    expect(html).toContain('alt="Acme &lt;Clinic&gt;"');
    expect(html).toContain('Powered by HealthProHub');
  });

  it('falls back to the workspace name when there is no logo', () => {
    const { html } = renderSigningLinkEmail({ ...signing, brand: { ...brand, logoUrl: null } });
    expect(html).not.toContain('<img');
    expect(html).toContain('Acme &lt;Clinic&gt;');
  });

  it('never lets an invalid stored colour into the HTML', () => {
    const { html } = renderSigningLinkEmail({
      ...signing,
      brand: { ...brand, color: 'red;"><script>' },
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('#0f766e');
  });

  it('does not change the plain-text copy', () => {
    expect(renderSigningLinkEmail({ ...signing, brand }).text).toBe(
      renderSigningLinkEmail(signing).text,
    );
  });

  it('brands the cancellation and download-renewal emails but not the sender notices', () => {
    const voided = renderVoidedEmail({
      to: 'priya@example.com',
      recipientName: 'Priya',
      senderName: 'Raj',
      envelopeTitle: 'Lease',
      reason: 'Wrong version',
      brand,
    });
    expect(voided.html).toContain('#1d4ed8');
    const declined = renderDeclinedEmail({
      to: 'raj@example.com',
      senderName: 'Raj',
      recipientName: 'Priya',
      envelopeTitle: 'Lease',
      reason: 'No',
      envelopeUrl: 'https://app.example.com/dashboard/envelopes/1',
    });
    expect(declined.html).not.toContain('#1d4ed8');
  });

  it('brands the delegation notice for the delegator only', () => {
    const notice = {
      to: 'a@example.com',
      name: 'Asha',
      delegatorName: 'Asha',
      delegateName: 'Dev',
      envelopeTitle: 'Lease',
      envelopeUrl: 'https://app.example.com/dashboard/envelopes/1',
      brand,
    };
    expect(renderDelegationNoticeEmail({ ...notice, audience: 'delegator' }).html).toContain(
      '#1d4ed8',
    );
    expect(renderDelegationNoticeEmail({ ...notice, audience: 'sender' }).html).not.toContain(
      '#1d4ed8',
    );
  });
});
