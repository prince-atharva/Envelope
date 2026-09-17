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

export type UserRole = 'OWNER' | 'ADMIN' | 'MEMBER';

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
