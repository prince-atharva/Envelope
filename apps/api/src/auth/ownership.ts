import { AppException } from '../common/errors/app-exception';
import type { AuthenticatedUser } from './auth.types';

/**
 * A MEMBER may manage only the envelopes they own; ADMIN and OWNER may manage
 * any envelope of the tenant (docs/17 step 5, docs/03: "caller is sender or
 * admin"). Applied to the lifecycle routes: cancel, extend and reminders.
 * List and detail visibility are scoped separately, in EnvelopesService.
 */
export function assertCanManage(ownerId: string, user: AuthenticatedUser): void {
  if (user.role === 'MEMBER' && ownerId !== user.id) {
    throw new AppException('FORBIDDEN_ROLE', 'Only the sender or a tenant admin can do this.');
  }
}

/**
 * The owner id to scope a list, count or detail read to: the user's own id
 * for a MEMBER, or undefined (no scoping — the whole tenant) for ADMIN and
 * OWNER (docs/17 step 5).
 */
export function ownerScopeOf(user: AuthenticatedUser): string | undefined {
  return user.role === 'MEMBER' ? user.id : undefined;
}
