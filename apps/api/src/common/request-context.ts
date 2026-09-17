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
}
