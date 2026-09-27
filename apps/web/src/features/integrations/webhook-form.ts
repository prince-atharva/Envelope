import type { CreateWebhookEndpointInput, WebhookEventType } from '@envelope/shared';

export function webhookSubscribedEvents(
  allEvents: boolean,
  selected: readonly WebhookEventType[],
): WebhookEventType[] {
  return allEvents ? [] : [...selected];
}

export function webhookInput(
  url: string,
  description: string,
  allEvents: boolean,
  selected: readonly WebhookEventType[],
  includeBlankDescription = false,
): CreateWebhookEndpointInput {
  return {
    url,
    ...(description.trim() || includeBlankDescription ? { description: description.trim() } : {}),
    subscribedEvents: webhookSubscribedEvents(allEvents, selected),
  };
}
