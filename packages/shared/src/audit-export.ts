import { z } from 'zod';
import { emailSchema, passwordSchema, USER_ROLES, type UserRole } from './auth';
import { MAX_RECIPIENT_NAME_LENGTH } from './limits';

/**
 * Audit export (docs/17 step 9, AUD-06). JSON is the machine-readable format:
 * self-sufficient, so someone with the file and no access to the platform can
 * re-verify the chain offline, exactly the way `verifyChain()` does server
 * side (apps/api/src/audit/audit-chain.ts). CSV carries the same rows without
 * the hashes, for human review and disclosure.
 */

export interface AuditExportEvent {
  sequence: number;
  action: string;
  timestamp: string;
  actorUserId: string | null;
  recipientId: string | null;
  ipAddress: string;
  userAgent: string;
  metadata: unknown;
  prevHash: string | null;
  eventHash: string;
}

export interface AuditExportDocument {
  envelopeId: string;
  exportedAt: string;
  /** How `eventHash` is computed, so the chain can be recomputed without this codebase. */
  algorithm: 'SHA-256(prevHash | action | timestamp | canonicalJson(payload))';
  events: AuditExportEvent[];
  verification: { valid: true } | { valid: false; brokenAtSequence: number; reason: string };
}

export const auditExportQuerySchema = z.strictObject({
  format: z.enum(['json', 'csv']).default('json'),
});
export type AuditExportQuery = z.infer<typeof auditExportQuerySchema>;

/**
 * Users and roles (docs/17 step 6). `OWNER` only for every write here; see
 * `hasAtLeast` in auth.ts.
 */
export interface TenantUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  lastLoginAt: string | null;
  createdAt: string;
}

export const inviteUserSchema = z.strictObject({
  fullName: z.string().trim().min(2, 'Enter their full name').max(MAX_RECIPIENT_NAME_LENGTH),
  email: emailSchema,
  role: z.enum(USER_ROLES).default('MEMBER'),
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

export const changeUserRoleSchema = z.strictObject({
  role: z.enum(USER_ROLES),
});
export type ChangeUserRoleInput = z.infer<typeof changeUserRoleSchema>;

export interface InviteUserResponse {
  user: TenantUser;
}

/** GET /auth/invitations/:token: what the accept-invite screen shows before a password is chosen. */
export interface InvitationPreview {
  fullName: string;
  email: string;
  workspaceName: string;
  roleLabel: string;
  expiresAt: string;
}

export const acceptInviteSchema = z.strictObject({ password: passwordSchema });
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
