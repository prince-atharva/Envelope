import type { Server } from 'node:http';
import type { RecoveryCodesResponse, TwoFactorSetup } from '@envelope/shared';
import request from 'supertest';
import { totpCodeAt, totpStep } from '../../src/auth/totp';
import type { SignedInUser } from './auth';
import { nextClientIp } from './auth';
import { ownerQuery } from './db';
import { bearer } from './signing';

/** The code an authenticator app would show now (or `offset` 30-second steps from now). */
export function codeFor(secret: string, offset = 0): string {
  return totpCodeAt(secret, totpStep(new Date()) + offset);
}

/**
 * Forgets the last accepted step, so a test can use another code in the same
 * 30 seconds. Replay itself is tested without calling this.
 */
export async function forgetLastStep(userId: string): Promise<void> {
  await ownerQuery(`UPDATE "User" SET "totpLastStep" = NULL WHERE id = $1`, [userId]);
}

export interface Enrolled {
  secret: string;
  recoveryCodes: string[];
}

/** Sets up and enables two-factor for a signed-in user, through the real routes. */
export async function enrol(http: Server, user: SignedInUser): Promise<Enrolled> {
  const setup = await request(http)
    .post('/api/v1/auth/2fa/setup')
    .set('Authorization', bearer(user))
    .set('X-Forwarded-For', nextClientIp())
    .expect(200);
  const { secret } = setup.body as TwoFactorSetup;
  const enabled = await request(http)
    .post('/api/v1/auth/2fa/enable')
    .set('Authorization', bearer(user))
    .set('X-Forwarded-For', nextClientIp())
    .send({ code: codeFor(secret) })
    .expect(200);
  return { secret, recoveryCodes: (enabled.body as RecoveryCodesResponse).recoveryCodes };
}
