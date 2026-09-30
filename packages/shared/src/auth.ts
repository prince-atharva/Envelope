import { z } from 'zod';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './limits';

/** Trimmed, lower-cased email. Validation runs on the normalised value. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ error: 'Enter a valid email address' }));

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters`);

export const registerSchema = z.strictObject({
  fullName: z.string().trim().min(2, 'Enter your full name').max(120),
  email: emailSchema,
  password: passwordSchema,
  organization: z.string().trim().min(2).max(160).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.strictObject({
  email: emailSchema,
  // Only a length cap here: login must not reveal the password policy.
  password: z.string().min(1, 'Enter your password').max(PASSWORD_MAX_LENGTH),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** POST /auth/password/forgot (docs/19, ADR 0022). */
export const forgotPasswordSchema = z.strictObject({ email: emailSchema });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/** POST /auth/password/change (docs/19 slice 2): the signed-in person changes their own password. */
export const changePasswordSchema = z
  .strictObject({
    currentPassword: z.string().min(1, 'Enter your current password').max(PASSWORD_MAX_LENGTH),
    newPassword: passwordSchema,
  })
  .refine((input) => input.newPassword !== input.currentPassword, {
    path: ['newPassword'],
    message: 'Choose a password you are not already using',
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** POST /auth/password/reset/:token. The same policy as registration. */
export const resetPasswordSchema = z.strictObject({ password: passwordSchema });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/**
 * The 202 body of the forgot route. It is identical for every address, known or
 * not (ADR 0022), so it must not say whether an email was sent.
 */
export interface ForgotPasswordResponse {
  message: string;
}
export const FORGOT_PASSWORD_MESSAGE =
  'If an account exists for that address, we have emailed a link to reset the password.';

/** GET /auth/password/reset/:token: what the reset screen shows before a password is chosen. */
export interface PasswordResetPreview {
  /** Masked, like a log line: enough to recognise the account, not to harvest it. */
  email: string;
  expiresAt: string;
}

export type UserRole = 'OWNER' | 'ADMIN' | 'MEMBER';
export const USER_ROLES: readonly UserRole[] = ['OWNER', 'ADMIN', 'MEMBER'];

/**
 * Lowest to highest, so `hasAtLeast` is one comparison. The guard and the
 * web app's `RequireRole` both read this, rather than each keeping its own
 * ordering that could drift (docs/17 step 5).
 */
export const ROLE_RANK: Record<UserRole, number> = { MEMBER: 0, ADMIN: 1, OWNER: 2 };

export function hasAtLeast(role: UserRole, minimum: UserRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  organization: string | null;
  role: UserRole;
  tenant: { id: string; name: string; slug: string };
}

/** Returned by register, login and refresh. The refresh token travels only in an httpOnly cookie. */
export interface AuthResponse {
  accessToken: string;
  tokenType: 'Bearer';
  /** Seconds until the access token expires. */
  expiresIn: number;
  user: UserProfile;
}
