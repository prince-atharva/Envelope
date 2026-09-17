/** The signed-in sender, attached to the request by JwtAuthGuard. */
export interface AuthenticatedUser {
  id: string;
  tenantId: string;
  sessionId: string;
}

/** Claims inside the short-lived access token. */
export interface AccessTokenClaims {
  sub: string;
  tid: string;
  sid: string;
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
