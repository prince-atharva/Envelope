import { infiniteQueryOptions } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { queryKeys } from '../../lib/query-keys';

/**
 * The rest of an envelope's audit trail, past what the detail response
 * already carries (100M-row scale follow-up web pass, docs/16 step 14). The
 * detail's own `eventsCursor` is the starting point — this query never runs
 * before it is known, and never re-fetches the events the detail already
 * has.
 */
export function envelopeEventsQuery(id: string, startCursor: string) {
  return infiniteQueryOptions({
    queryKey: queryKeys.envelopeEvents(id),
    queryFn: ({ pageParam }) => api.getEnvelopeEvents(id, pageParam),
    initialPageParam: startCursor,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}
