import { SetMetadata } from '@nestjs/common';

export const API_KEY_ALLOWED_KEY = 'digitalsign:apiKeyAllowed';

export interface ApiKeyAllowedOptions {
  /** Whether this route writes. A read-only API key is refused here (docs/08). */
  write: boolean;
}

/**
 * Opts a route into API-key auth (docs/08, docs/18). Unmarked routes accept
 * only a JWT session — closed by default, deliberately narrower than a key's
 * nominal "whole tenant" scope. This phase allow-lists envelope
 * create/upload, draft edits, send, and reads only.
 */
export const ApiKeyAllowed = (options: ApiKeyAllowedOptions) =>
  SetMetadata(API_KEY_ALLOWED_KEY, options);
