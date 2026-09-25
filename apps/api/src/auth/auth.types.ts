import type { UserRole } from '@envelope/shared';

/**
 * The signed-in sender, or an API key acting as the tenant's service account
 * (docs/18), attached to the request by JwtAuthGuard.
 */
export interface AuthenticatedUser {
  id: string;
  tenantId: string;
  sessionId: string;
  /** OWNER, ADMIN or MEMBER (docs/17 step 5). Read once, at token issue, not per request. */
  role: UserRole;
  /** Set only when the caller authenticated with an API key, never a JWT (docs/18). */
  apiKeyId?: string;
}

/** Claims inside the short-lived access token. */
export interface AccessTokenClaims {
  sub: string;
  tid: string;
  sid: string;
  role: UserRole;
}

/** Where a request came from; stored on sessions and written to logs. */
export interface ClientInfo {
  ip: string;
  userAgent: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}
