import type { WebhookDeliveryStatus, WebhookEventType } from '@envelope/shared';
import { infiniteQueryOptions } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { queryKeys } from '../../lib/query-keys';

/**
 * One endpoint's delivery history, filtered and paged through the
 * tenant-wide browsing route (docs/18 workstream 8 steps 8.4-8.5), in place
 * of the deprecated GET /webhooks/:id/deliveries.
 */
export function webhookDeliveriesQuery(
  endpointId: string,
  status?: WebhookDeliveryStatus,
  eventType?: WebhookEventType,
) {
  return infiniteQueryOptions({
    queryKey: queryKeys.webhookDeliveries(endpointId, status, eventType),
    queryFn: ({ pageParam }) =>
      api.listWebhookDeliveriesPage({ endpointId, status, eventType, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}
