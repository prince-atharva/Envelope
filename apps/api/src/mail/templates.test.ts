import { describe, expect, it } from 'vitest';
import { escapeHtml, renderWelcomeEmail } from './templates';

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
    expect(email.subject).toBe('Welcome to Digital Sign by HealthProHub');
    expect(email.html).toContain('href="https://sign.example.com/dashboard"');
    expect(email.text).toContain('Open Digital Sign: https://sign.example.com/dashboard');
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

  it('escapes all five HTML special characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });
});
