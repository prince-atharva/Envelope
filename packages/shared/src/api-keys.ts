import { z } from 'zod';
import { MAX_API_KEY_LABEL_LENGTH } from './limits';

/**
 * Server-to-server auth for a third-party integration (docs/08, "Server
 * integration"; docs/18). A key acts as the tenant's whole scope — it is not
 * tied to any one human's role or employment.
 */

export const createApiKeySchema = z.strictObject({
  label: z.string().trim().min(2, 'Give this key a label').max(MAX_API_KEY_LABEL_LENGTH),
  /** SHOULD support read-only variants (docs/08). Defaults to full access. */
  readOnly: z.boolean().default(false),
});
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;

export interface ApiKeySummary {
  id: string;
  label: string;
  /** The raw key's first characters, so keys can be told apart without the full value. */
  displayPrefix: string;
  readOnly: boolean;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/** The raw key is returned only here, once, at creation. It is never shown again. */
export interface CreateApiKeyResponse {
  apiKey: ApiKeySummary;
  rawKey: string;
}
