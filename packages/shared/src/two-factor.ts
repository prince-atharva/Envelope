import { z } from 'zod';
import type { AuthResponse } from './auth';
import { PASSWORD_MAX_LENGTH } from './limits';

/** A six-digit code from an authenticator app. */
export const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app');

/** `xxxxx-xxxxx` from the alphabet in `api/src/auth/recovery-codes.ts`, lower case. */
const RECOVERY_CODE_PATTERN = /^[0-9a-hjkmnp-tv-z]{5}-?[0-9a-hjkmnp-tv-z]{5}$/;

/** Either a six-digit authenticator code or a recovery code. */
export const secondFactorCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine((value) => /^\d{6}$/.test(value) || RECOVERY_CODE_PATTERN.test(value), {
    message: 'Enter the 6-digit code, or a recovery code',
  });

const challengeTokenSchema = z.string().min(1, 'Sign in again').max(2000);
const passwordField = z.string().min(1, 'Enter your password').max(PASSWORD_MAX_LENGTH);

/** POST /auth/2fa/enable. */
export const enableTwoFactorSchema = z.strictObject({ code: totpCodeSchema });
export type EnableTwoFactorInput = z.infer<typeof enableTwoFactorSchema>;

/** POST /auth/2fa/disable and POST /auth/2fa/recovery-codes: the password and a current code. */
export const confirmTwoFactorSchema = z.strictObject({
  password: passwordField,
  code: secondFactorCodeSchema,
});
export type ConfirmTwoFactorInput = z.infer<typeof confirmTwoFactorSchema>;

/** POST /auth/2fa/challenge: the second step of a sign-in. */
export const twoFactorChallengeSchema = z.strictObject({
  challengeToken: challengeTokenSchema,
  code: secondFactorCodeSchema,
});
export type TwoFactorChallengeInput = z.infer<typeof twoFactorChallengeSchema>;

/** POST /auth/2fa/enrol/start: a required enrolment before the first session (ADR 0025). */
export const twoFactorEnrolStartSchema = z.strictObject({ challengeToken: challengeTokenSchema });
export type TwoFactorEnrolStartInput = z.infer<typeof twoFactorEnrolStartSchema>;

/** POST /auth/2fa/enrol/finish. */
export const twoFactorEnrolFinishSchema = z.strictObject({
  challengeToken: challengeTokenSchema,
  code: totpCodeSchema,
});
export type TwoFactorEnrolFinishInput = z.infer<typeof twoFactorEnrolFinishSchema>;

/** PUT /tenant/two-factor (OWNER). */
export const setTwoFactorPolicySchema = z.strictObject({ required: z.boolean() });
export type SetTwoFactorPolicyInput = z.infer<typeof setTwoFactorPolicySchema>;

/** PUT /tenant/two-factor. */
export interface TwoFactorPolicy {
  required: boolean;
}

/** GET /auth/2fa. */
export interface TwoFactorStatus {
  enabled: boolean;
  recoveryCodesRemaining: number;
  /** The workspace requires everyone to use a second factor. */
  required: boolean;
}

/** POST /auth/2fa/setup and /enrol/start: shown once, to be scanned or typed into an app. */
export interface TwoFactorSetup {
  secret: string;
  otpauthUri: string;
}

/** POST /auth/2fa/enable and /recovery-codes: the codes are shown once and never again. */
export interface RecoveryCodesResponse {
  recoveryCodes: string[];
}

/** POST /auth/login when the password was right and a factor is enrolled. No session yet. */
export interface MfaChallengeResponse {
  mfaRequired: true;
  challengeToken: string;
}

/** POST /auth/login when the workspace requires a factor and this person has none. No session yet. */
export interface MfaEnrolmentRequiredResponse {
  mfaEnrolmentRequired: true;
  challengeToken: string;
}

export type LoginResponse = AuthResponse | MfaChallengeResponse | MfaEnrolmentRequiredResponse;

export function isMfaChallenge(response: LoginResponse): response is MfaChallengeResponse {
  return 'mfaRequired' in response;
}

export function isMfaEnrolmentRequired(
  response: LoginResponse,
): response is MfaEnrolmentRequiredResponse {
  return 'mfaEnrolmentRequired' in response;
}

/** POST /auth/2fa/enrol/finish: the normal sign-in result, plus the codes to keep. */
export type EnrolFinishResponse = AuthResponse & RecoveryCodesResponse;
