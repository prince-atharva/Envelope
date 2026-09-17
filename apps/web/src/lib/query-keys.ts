/**
 * Every TanStack Query key in one place, so invalidating after a change cannot
 * miss a cache written somewhere else.
 */
export const queryKeys = {
  envelopes: ['envelopes'] as const,
  envelope: (id: string) => ['envelope', id] as const,
  document: (id: string, version = 0) => ['document', id, version] as const,
};
