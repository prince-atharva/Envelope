import type { EnvelopeView } from '@envelope/shared';
import { infiniteQueryOptions } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { queryKeys } from '../../lib/query-keys';

/**
 * One dashboard list, as the dashboard, its tab prefetch and quick search all
 * read it. They share a cache entry, so they must agree on its shape: a plain
 * `useQuery` on the same key stores a single page where the dashboard expects
 * a list of pages, and whichever reads second finds nothing.
 */
export function envelopeListQuery(view: EnvelopeView) {
  return infiniteQueryOptions({
    queryKey: queryKeys.envelopeList(view),
    queryFn: ({ pageParam }) => api.listEnvelopes(view, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}
