import type { UserRole } from '@envelope/shared';
import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'digitalsign:minRole';

/**
 * The lowest role a route accepts (docs/17 step 5). Unmarked routes accept
 * any signed-in user, exactly as before this phase — this is additive, not a
 * default-deny change. `RolesGuard` compares against `ROLE_RANK`, so
 * `@Roles('ADMIN')` also admits `OWNER`.
 */
export const Roles = (minimum: UserRole) => SetMetadata(ROLES_KEY, minimum);
