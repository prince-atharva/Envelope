import type { ClsStore } from 'nestjs-cls';

/**
 * Per-request values available anywhere through ClsService, without passing
 * them through every call. The request id itself is ClsService.getId().
 */
export interface RequestContext extends ClsStore {
  ip: string;
  userAgent: string;
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  embedActor?: { embedSessionId: string; externalActorId: string };
  /** How many database queries this request has run so far (PrismaService). */
  dbQueryCount?: number;
}
