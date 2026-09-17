import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppException } from '../common/errors/app-exception';
import { AppConfig } from '../config/app-config';
import type { Prisma, Session } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ClientInfo } from './auth.types';

/**
 * A just-rotated refresh token presented again within this window is treated as
 * a harmless race (two tabs refreshing at once), not as theft. Outside the window,
 * reuse revokes every session descended from the same login.
 */
export const REFRESH_REUSE_GRACE_MS = 30_000;

const MAX_USER_AGENT_LENGTH = 500;

export type RevokeReason = 'rotated' | 'logout' | 'reuse-detected';

export interface IssuedSession {
  /** The raw token. It goes into the cookie and is never stored or logged. */
  refreshToken: string;
  session: Session;
}

type Db = Prisma.TransactionClient | PrismaService;

function sessionExpired(): AppException {
  return new AppException('SESSION_EXPIRED', 'Your session has ended. Please sign in again.');
}

/** Refresh-token sessions with rotation and reuse detection (docs/10, "Session"). */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    @InjectPinoLogger(SessionService.name) private readonly logger: PinoLogger,
  ) {}

  /** Only this HMAC is stored, so a database leak does not yield usable tokens. */
  hashToken(refreshToken: string): string {
    return createHmac('sha256', this.config.REFRESH_TOKEN_SECRET)
      .update(refreshToken)
      .digest('hex');
  }

  async create(
    userId: string,
    client: ClientInfo,
    familyId: string = randomUUID(),
    db: Db = this.prisma,
  ): Promise<IssuedSession> {
    const refreshToken = randomBytes(32).toString('base64url');
    const session = await db.session.create({
      data: {
        userId,
        familyId,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + this.config.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
        ip: client.ip,
        userAgent: client.userAgent.slice(0, MAX_USER_AGENT_LENGTH),
      },
    });
    return { refreshToken, session };
  }

  /** Exchanges a refresh token for a new one. The old token stops working. */
  async rotate(refreshToken: string, client: ClientInfo): Promise<IssuedSession> {
    const now = new Date();
    const current = await this.prisma.session.findUnique({
      where: { tokenHash: this.hashToken(refreshToken) },
    });
    if (!current) {
      this.logger.warn({ ip: client.ip }, 'Refresh rejected: unknown refresh token');
      throw sessionExpired();
    }

    const who = {
      userId: current.userId,
      sessionId: current.id,
      familyId: current.familyId,
      ip: client.ip,
    };

    if (current.revokedAt) {
      const sinceRevokedMs = now.getTime() - current.revokedAt.getTime();
      if (current.revokedReason === 'rotated' && sinceRevokedMs > REFRESH_REUSE_GRACE_MS) {
        const { count } = await this.prisma.session.updateMany({
          where: { familyId: current.familyId, revokedAt: null },
          data: { revokedAt: now, revokedReason: 'reuse-detected' satisfies RevokeReason },
        });
        this.logger.warn(
          { ...who, sinceRevokedMs, revokedSessions: count },
          'Refresh token reuse detected; every session from this login was revoked',
        );
      } else {
        this.logger.info(
          { ...who, reason: current.revokedReason, sinceRevokedMs },
          'Refresh rejected: session already revoked',
        );
      }
      throw sessionExpired();
    }

    if (current.expiresAt <= now) {
      this.logger.info(who, 'Refresh rejected: session expired');
      throw sessionExpired();
    }

    const issued = await this.prisma.$transaction(async (tx) => {
      // The revokedAt condition makes this safe against two concurrent rotations.
      const { count } = await tx.session.updateMany({
        where: { id: current.id, revokedAt: null },
        data: {
          revokedAt: now,
          revokedReason: 'rotated' satisfies RevokeReason,
          lastUsedAt: now,
        },
      });
      if (count === 0) return null;
      const next = await this.create(current.userId, client, current.familyId, tx);
      await tx.session.update({
        where: { id: current.id },
        data: { replacedById: next.session.id },
      });
      return next;
    });

    if (!issued) {
      this.logger.info(who, 'Refresh rejected: token was rotated by a concurrent request');
      throw sessionExpired();
    }

    this.logger.info({ ...who, newSessionId: issued.session.id }, 'Session refreshed');
    return issued;
  }

  /** Ends the session behind a refresh token. Returns it, or null if it was not active. */
  async revoke(refreshToken: string, reason: RevokeReason): Promise<Session | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: this.hashToken(refreshToken) },
    });
    if (!session || session.revokedAt) return null;
    await this.prisma.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return session;
  }

  async isActive(sessionId: string): Promise<boolean> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { revokedAt: true, expiresAt: true },
    });
    return session !== null && session.revokedAt === null && session.expiresAt > new Date();
  }
}
