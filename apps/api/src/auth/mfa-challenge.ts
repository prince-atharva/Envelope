import { randomUUID } from 'node:crypto';
import { MFA_CHALLENGE_TTL_SECONDS } from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppException } from '../common/errors/app-exception';

/** What a challenge token may be used for: the code step of a sign-in, or a required enrolment. */
export type MfaPurpose = 'mfa' | 'mfa-enrol';

interface MfaChallengeClaims {
  sub: string;
  purpose: MfaPurpose;
}

/**
 * The token that stands in for "password right, second factor not yet given"
 * (docs/19, ADR 0024, ADR 0025). It is a short JWT with a `purpose` claim and
 * no session id, so `JwtAuthGuard` cannot mistake it for an access token, and
 * each route that takes one checks the purpose it expects.
 */
@Injectable()
export class MfaChallengeService {
  constructor(private readonly jwt: JwtService) {}

  issue(userId: string, purpose: MfaPurpose): Promise<string> {
    const claims: MfaChallengeClaims = { sub: userId, purpose };
    // A random id makes every challenge unique. Without it two issued in the same
    // second for one person are the same string, and would share one attempt counter.
    return this.jwt.signAsync(claims, {
      expiresIn: MFA_CHALLENGE_TTL_SECONDS,
      jwtid: randomUUID(),
    });
  }

  /** The user id the token was issued for, or `TWO_FACTOR_CHALLENGE_INVALID`. */
  async verify(token: string, purpose: MfaPurpose): Promise<string> {
    let claims: Partial<MfaChallengeClaims> & { sid?: string };
    try {
      claims = await this.jwt.verifyAsync<typeof claims>(token);
    } catch {
      throw new AppException('TWO_FACTOR_CHALLENGE_INVALID');
    }
    // An access token has a session id and no purpose; it must not answer a challenge.
    if (claims.purpose !== purpose || claims.sid !== undefined || !claims.sub) {
      throw new AppException('TWO_FACTOR_CHALLENGE_INVALID');
    }
    return claims.sub;
  }
}
