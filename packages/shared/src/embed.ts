import { z } from 'zod';

export const EMBED_PROTOCOL_VERSION = 1;
export const EMBED_LAUNCH_TTL_MS = 60_000;
export const EMBED_SESSION_TTL_MS = 30 * 60_000;
export const EMBED_LAUNCH_PREFIX = 'eel_';
export const EMBED_ACCESS_PREFIX = 'eea_';

const canonicalUrlSchema = z.url({ normalize: true });
export const embedOriginSchema = z
  .url()
  .max(2048)
  .refine((value) => {
    const normalized = canonicalUrlSchema.safeParse(value);
    if (!normalized.success || normalized.data !== `${value}/`) return false;
    if (/^https:.*:0*443$/.test(value) || /^http:.*:0*80$/.test(value)) return false;
    if (/:0[0-9]+$/.test(value)) return false;
    if (/^https:\/\/[a-zA-Z0-9.-]+(?::[0-9]{1,5})?$/.test(value)) return true;
    return /^http:\/\/(?:127\.0\.0\.1|\[::1\]|localhost)(?::[0-9]{1,5})?$/.test(value);
  }, 'Use an exact HTTPS origin (loopback HTTP is test-only)');
export const setEmbedOriginsSchema = z.strictObject({
  origins: z
    .array(embedOriginSchema)
    .max(10)
    .refine((values) => new Set(values).size === values.length, 'Origins must be unique'),
});
export const embedActionsSchema = z
  .array(z.enum(['edit', 'send']))
  .min(1)
  .max(2)
  .refine(
    (values) => values.includes('edit') && new Set(values).size === values.length,
    'Edit is required and actions must be unique',
  );
const common = {
  parentOrigin: embedOriginSchema,
  externalActorId: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[a-zA-Z0-9_.:@-]+$/),
  actions: embedActionsSchema,
};
export const createEmbedSessionSchema = z.discriminatedUnion('mode', [
  z.strictObject({ ...common, mode: z.literal('existing'), envelopeId: z.uuid() }),
  z.strictObject({ ...common, mode: z.literal('upload') }),
]);
export const exchangeEmbedSessionSchema = z.strictObject({
  sessionId: z.uuid(),
  launchToken: z.string().regex(/^eel_[a-f0-9]{64}$/),
});
export type CreateEmbedSessionInput = z.infer<typeof createEmbedSessionSchema>;
export type EmbedActions = z.infer<typeof embedActionsSchema>;
export interface CreateEmbedSessionResponse {
  sessionId: string;
  launchToken: string;
  launchExpiresAt: string;
  frameUrl: string;
}
export interface EmbedSessionResponse {
  accessToken: string;
  expiresAt: string;
  envelopeId: string | null;
  mode: 'existing' | 'upload';
  actions: EmbedActions;
}
const base = { version: z.literal(EMBED_PROTOCOL_VERSION), sessionId: z.uuid() };
export const embedParentMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...base,
    type: z.literal('launch'),
    launchToken: exchangeEmbedSessionSchema.shape.launchToken,
  }),
  z.strictObject({ ...base, type: z.literal('request.close') }),
]);
export const embedEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...base, type: z.literal('ready') }),
  z.strictObject({ ...base, type: z.literal('draft.created'), envelopeId: z.uuid() }),
  z.strictObject({
    ...base,
    type: z.literal('draft.saved'),
    envelopeId: z.uuid(),
    revision: z.number().int().min(0),
  }),
  z.strictObject({ ...base, type: z.literal('envelope.sent'), envelopeId: z.uuid() }),
  z.strictObject({ ...base, type: z.literal('close') }),
  z.strictObject({ ...base, type: z.literal('error'), code: z.string().regex(/^[A-Z_]{1,80}$/) }),
  z.strictObject({ ...base, type: z.literal('session.expired') }),
]);
export type EmbedEvent = z.infer<typeof embedEventSchema>;
