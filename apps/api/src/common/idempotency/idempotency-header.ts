/** OpenAPI description of the Idempotency-Key header, for every route that requires it. */
export const IDEMPOTENCY_KEY_HEADER = {
  name: 'Idempotency-Key',
  required: true,
  description:
    'A value unique to this attempt (a UUID is ideal). Repeating the request with the same key ' +
    'within 24 hours returns the first response with Idempotency-Replayed: true, and sends nothing.',
};

/** For the create routes, where the key is optional (docs/18 workstream 10, ADR 0019). */
export const OPTIONAL_IDEMPOTENCY_KEY_HEADER = {
  name: 'Idempotency-Key',
  required: false,
  description:
    'Optional. A value unique to this attempt (a UUID is ideal). Repeating the request with the ' +
    'same key and the same body within 24 hours returns the resource the first request created ' +
    '(with Idempotency-Replayed: true) instead of creating another. Without a key, every request ' +
    'creates a new one.',
};
