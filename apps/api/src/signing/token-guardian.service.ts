import { isOpenEnvelope, SIGNING_TOKEN_PATTERN, type TerminalReason } from '@envelope/shared';

export interface ResolveOptions {
  /**
   * Accept a link whose only fault is that it expired, on an envelope that is
   * open or paused (docs/16 step 8). Used by exactly one route: asking the
   * sender for more time.
   */
  allowExpired?: boolean;
}

import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppException } from '../common/errors/app-exception';
import type { RequestContext } from '../common/request-context';
import { AppConfig } from '../config/app-config';
import type { Envelope, Recipient } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hashSigningToken, tokenRef } from './signing-token';

/** Every field any handler in signing.service.ts reads off a resolved signer. */
const RECIPIENT_FIELDS = {
  id: true,
  email: true,
  status: true,
  tokenUsedAt: true,
  tokenExpiresAt: true,
  consentGivenAt: true,
  name: true,
  role: true,
  signatureMethod: true,
  initialsMethod: true,
  signatureImageKey: true,
  initialsImageKey: true,
  servedVersionNumber: true,
  viewedAt: true,
} as const;

const ENVELOPE_FIELDS = {
  id: true,
  tenantId: true,
  status: true,
  expiresAt: true,
  jurisdictionCode: true,
  policySnapshot: true,
  title: true,
  pageCount: true,
  message: true,
} as const;

type ResolvedRecipient = Pick<Recipient, keyof typeof RECIPIENT_FIELDS>;
type ResolvedEnvelope = Pick<Envelope, keyof typeof ENVELOPE_FIELDS> & {
  owner: { fullName: string };
};

export interface SignerContext {
  recipient: ResolvedRecipient;
  envelope: ResolvedEnvelope;
  /** For log lines. Never the token itself. */
  tokenRef: string;
  /** True when the link was accepted only because `allowExpired` was set. */
  expired: boolean;
}

export type AccessRefusal =
  | { code: 'ENVELOPE_TERMINAL'; reason: TerminalReason }
  | { code: 'TOKEN_ALREADY_USED' }
  | { code: 'TOKEN_EXPIRED'; expiredAt: Date }
  | { code: 'ENVELOPE_NOT_OPEN' };

type AccessRecipient = Pick<Recipient, 'status' | 'tokenUsedAt' | 'tokenExpiresAt'>;
type AccessEnvelope = Pick<Envelope, 'status' | 'expiresAt'>;

/**
 * Whether a known link may still be used, checked in a fixed order so each
 * signer sees the right screen (ADR 0009): cancelled or declined first, then
 * already signed, then expired. A person who signed and whose link has since
 * expired is told they signed, not that the link expired. An envelope paused
 * as EXPIRED reads as an expired link (ADR 0013), even if its deadline has
 * already been moved and the sweep has not caught up.
 */
export function checkSignerAccess(
  recipient: AccessRecipient,
  envelope: AccessEnvelope,
  now: Date,
): AccessRefusal | null {
  if (envelope.status === 'VOIDED') return { code: 'ENVELOPE_TERMINAL', reason: 'VOIDED' };
  if (envelope.status === 'DECLINED') {
    return {
      code: 'ENVELOPE_TERMINAL',
      reason: recipient.status === 'DECLINED' ? 'YOU_DECLINED' : 'DECLINED',
    };
  }

  if (recipient.status === 'SIGNED' || recipient.tokenUsedAt) return { code: 'TOKEN_ALREADY_USED' };

  const expiresAt = earliest(recipient.tokenExpiresAt, envelope.expiresAt);
  if (expiresAt && expiresAt <= now) return { code: 'TOKEN_EXPIRED', expiredAt: expiresAt };
  if (envelope.status === 'EXPIRED') return { code: 'TOKEN_EXPIRED', expiredAt: expiresAt ?? now };

  // COMPLETED with this person unsigned, or DRAFT with a token: neither should exist.
  if (!isOpenEnvelope(envelope.status)) return { code: 'ENVELOPE_NOT_OPEN' };
  return null;
}

const TERMINAL_DETAIL: Record<TerminalReason, string> = {
  VOIDED: 'The sender cancelled this document.',
  DECLINED: 'Someone declined this document, so it can no longer be signed.',
  YOU_DECLINED: 'You declined this document.',
};

function refusalException(refusal: AccessRefusal): AppException {
  switch (refusal.code) {
    case 'ENVELOPE_TERMINAL':
      return new AppException('ENVELOPE_TERMINAL', TERMINAL_DETAIL[refusal.reason], {
        reason: refusal.reason,
      });
    case 'TOKEN_ALREADY_USED':
      return new AppException('TOKEN_ALREADY_USED', 'You have already signed this document.');
    case 'TOKEN_EXPIRED':
      return new AppException(
        'TOKEN_EXPIRED',
        'This signing link has expired. Ask the sender to send it again.',
      );
    case 'ENVELOPE_NOT_OPEN':
      return new AppException('ENVELOPE_TERMINAL', 'This document is no longer open for signing.');
  }
}

/**
 * The Token Guardian (docs/03): the one place a signing link is checked.
 *
 * Public signing routes have no signed-in user, so they cannot use the tenant
 * client. The token is the only authority (docs/03): it names exactly one
 * recipient of one envelope, and every query after this one is scoped to those
 * two ids, never to anything the browser sends.
 */
@Injectable()
export class TokenGuardianService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly cls: ClsService<RequestContext>,
    @InjectPinoLogger(TokenGuardianService.name) private readonly logger: PinoLogger,
  ) {}

  hash(rawToken: string): string {
    return hashSigningToken(this.config.SIGNING_TOKEN_SECRET, rawToken);
  }

  async resolve(
    rawToken: string,
    now = new Date(),
    options: ResolveOptions = {},
  ): Promise<SignerContext> {
    if (!SIGNING_TOKEN_PATTERN.test(rawToken)) {
      this.logger.info('Signing link rejected: not a token');
      throw invalidLink();
    }

    const tokenHash = this.hash(rawToken);
    const ref = tokenRef(tokenHash);
    // Selected, not included: this runs on every signer request, and a full
    // recipient/envelope row carries consentText, signing telemetry and
    // other columns no handler here reads (100M-row scale follow-up,
    // docs/16 step 14).
    const found = await this.prisma.recipient.findUnique({
      where: { tokenHash },
      select: {
        ...RECIPIENT_FIELDS,
        envelope: { select: { ...ENVELOPE_FIELDS, owner: { select: { fullName: true } } } },
      },
    });
    if (!found) {
      // Never issued, or replaced by a newer email.
      this.logger.info({ tokenRef: ref }, 'Signing link rejected: unknown or replaced');
      throw invalidLink();
    }

    const { envelope, ...recipient } = found;
    if (this.cls.isActive()) {
      // Every later log line of this request names the envelope and recipient.
      this.cls.set('tenantId', envelope.tenantId);
      this.logger.assign({
        tenantId: envelope.tenantId,
        envelopeId: envelope.id,
        recipientId: recipient.id,
        tokenRef: ref,
      });
    }

    const refusal = checkSignerAccess(recipient, envelope, now);
    if (
      refusal?.code === 'TOKEN_EXPIRED' &&
      options.allowExpired &&
      (isOpenEnvelope(envelope.status) || envelope.status === 'EXPIRED')
    ) {
      return { recipient, envelope, tokenRef: ref, expired: true };
    }
    if (refusal) {
      const level = refusal.code === 'ENVELOPE_NOT_OPEN' ? 'warn' : 'info';
      this.logger[level](
        { refusal: refusal.code, reason: 'reason' in refusal ? refusal.reason : undefined },
        'Signing link refused',
      );
      throw refusalException(refusal);
    }

    return { recipient, envelope, tokenRef: ref, expired: false };
  }
}

function earliest(...dates: (Date | null)[]): Date | null {
  const present = dates.filter((date): date is Date => date !== null);
  if (present.length === 0) return null;
  return new Date(Math.min(...present.map((date) => date.getTime())));
}

function invalidLink(): AppException {
  return new AppException(
    'TOKEN_INVALID',
    'This signing link is not valid. If you received a newer email, use the link in that one.',
  );
}
