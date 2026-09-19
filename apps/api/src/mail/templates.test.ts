import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  renderCompletedEmail,
  renderDeclinedEmail,
  renderExpiredEmail,
  renderMoreTimeEmail,
  renderSigningLinkEmail,
  renderVoidedEmail,
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
    expect(email.subject).toBe('Welcome to Envelope by HealthProHub');
    expect(email.html).toContain('href="https://sign.example.com/dashboard"');
    expect(email.text).toContain('Open Envelope: https://sign.example.com/dashboard');
    expect(email.html).toContain('by HealthProHub');
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
