/** OpenAPI description of the Idempotency-Key header, for every route that requires it. */
export const IDEMPOTENCY_KEY_HEADER = {
  name: 'Idempotency-Key',
  required: true,
  description:
    'A value unique to this attempt (a UUID is ideal). Repeating the request with the same key ' +
    'within 24 hours returns the first response with Idempotency-Replayed: true, and sends nothing.',
};
