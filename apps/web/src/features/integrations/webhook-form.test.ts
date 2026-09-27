import { describe, expect, it } from 'vitest';
import { webhookInput, webhookSubscribedEvents } from './webhook-form';

describe('webhook form', () => {
  it('uses the API empty-list convention for all fired events', () => {
    expect(webhookSubscribedEvents(true, ['envelope.sent'])).toEqual([]);
  });

  it('keeps a custom event selection and omits a blank description', () => {
    expect(webhookInput('https://example.com/hooks', '  ', false, ['envelope.sent'])).toEqual({
      url: 'https://example.com/hooks',
      subscribedEvents: ['envelope.sent'],
    });
  });

  it('includes an empty description when an edit clears it', () => {
    expect(webhookInput('https://example.com/hooks', '  ', true, [], true)).toEqual({
      url: 'https://example.com/hooks',
      description: '',
      subscribedEvents: [],
    });
  });
});
