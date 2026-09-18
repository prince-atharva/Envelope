import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  renderDeclinedEmail,
  renderSigningLinkEmail,
  renderWelcomeEmail,
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
