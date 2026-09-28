import { z } from 'zod';
import { embedOriginSchema } from './embed';
import { MAX_API_KEY_LABEL_LENGTH } from './limits';

/**
 * Server-to-server auth for a third-party integration (docs/08, "Server
 * integration"; docs/18). A key acts as the tenant's whole scope — it is not
 * tied to any one human's role or employment.
 */

/**
 * Each key's own embedded-editor parent origins (docs/18 workstream 7, ADR
 * 0017): a read-only key can never launch a writable editor, so its list
 * must be empty; a full key's list defaults to empty (backend-only).
 */
export const apiKeyEmbedOriginsSchema = z
  .array(embedOriginSchema)
  .max(10)
  .refine((values) => new Set(values).size === values.length, 'Origins must be unique');

export const createApiKeySchema = z
  .strictObject({
    label: z.string().trim().min(2, 'Give this key a label').max(MAX_API_KEY_LABEL_LENGTH),
    /** SHOULD support read-only variants (docs/08). Defaults to full access. */
    readOnly: z.boolean().default(false),
    embedOrigins: apiKeyEmbedOriginsSchema.default([]),
  })
  .refine((value) => !value.readOnly || value.embedOrigins.length === 0, {
    message: 'A read-only key cannot have embedded-editor origins',
    path: ['embedOrigins'],
  });
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;

export const setApiKeyEmbedOriginsSchema = z.strictObject({
  origins: apiKeyEmbedOriginsSchema,
});
export type SetApiKeyEmbedOriginsInput = z.infer<typeof setApiKeyEmbedOriginsSchema>;

export interface ApiKeySummary {
  id: string;
  label: string;
  /** The raw key's first characters, so keys can be told apart without the full value. */
  displayPrefix: string;
  readOnly: boolean;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  /**
   * Optional in this step: `ApiKeyService` does not populate it yet (docs/18
   * workstream 7 step 7.1 introduces the contract only; step 7.2 wires it).
   */
  embedOrigins?: string[];
}

/** The raw key is returned only here, once, at creation. It is never shown again. */
export interface CreateApiKeyResponse {
  apiKey: ApiKeySummary;
  rawKey: string;
}
