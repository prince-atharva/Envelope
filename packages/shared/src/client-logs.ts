import { z } from 'zod';

/** A browser error report sent by the web app to POST /api/v1/client-logs. */
export const clientLogSchema = z.strictObject({
  level: z.enum(['error', 'warn']),
  message: z.string().min(1).max(2000),
  stack: z.string().max(6000).optional(),
  /** Page where the error happened. */
  url: z.string().max(2000),
  /** Where it was caught: "error-boundary", "window.onerror", "unhandledrejection", ... */
  source: z.string().max(100),
  /** Request id of the most recent API call, to connect browser and server logs. */
  lastRequestId: z.string().max(128).optional(),
  userAgent: z.string().max(500).optional(),
  occurredAt: z.iso.datetime().optional(),
});

export type ClientLog = z.infer<typeof clientLogSchema>;
