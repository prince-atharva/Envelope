/**
 * Every TanStack Query key in one place, so invalidating after a change cannot
 * miss a cache written somewhere else.
 */
export const queryKeys = {
  /** The prefix of every list and count, so one invalidation refreshes the whole dashboard. */
  envelopes: ['envelopes'] as const,
  envelopeList: (view: string) => ['envelopes', 'list', view] as const,
  envelopeCounts: ['envelopes', 'counts'] as const,
  envelope: (id: string) => ['envelope', id] as const,
  envelopeEvents: (id: string) => ['envelope', id, 'events'] as const,
  document: (id: string, version = 0) => ['document', id, version] as const,
};
