import { randomBytes } from 'node:crypto';
import {
  type AuthResponse,
  type ChangePasswordInput,
  FORGOT_PASSWORD_MESSAGE,
  type ForgotPasswordResponse,
  type InvitationPreview,
  type LoginInput,
  type PasswordResetPreview,
  type RegisterInput,
  type UserProfile,
} from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppException } from '../common/errors/app-exception';
import { AppConfig } from '../config/app-config';
import { Prisma, type Tenant, type User } from '../generated/prisma/client';
import { maskEmail } from '../logging/redact';
import { MailQueueService } from '../mail/mail-queue.service';
import { PrismaService } from '../prisma/prisma.service';
import { hashInviteToken, hashPasswordResetToken, tokenRef } from '../signing/signing-token';
import type { AccessTokenClaims, ClientInfo } from './auth.types';
import { PasswordService } from './password.service';
import { type IssuedSession, type RevokeReason, SessionService } from './session.service';

const ROLE_LABEL: Record<User['role'], string> = {
  OWNER: 'an owner',
  ADMIN: 'an admin',
  MEMBER: 'a member',
};

export interface AuthResult {
  response: AuthResponse;
  refreshToken: string;
}

/** URL-safe workspace slug base: "Clínica São José" becomes "clinica-sao-jose". */
export function slugify(text: string): string {
  const slug = text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // strip accents left by NFKD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'workspace';
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export function toUserProfile(user: User & { tenant: Tenant }): UserProfile {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    organization: user.organization,
    role: user.role,
    tenant: { id: user.tenant.id, name: user.tenant.name, slug: user.tenant.slug },
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly mailQueue: MailQueueService,
    @InjectPinoLogger(AuthService.name) private readonly logger: PinoLogger,
  ) {}

  /** Creates a workspace (tenant) and its owner, then signs the owner in. */
  async register(input: RegisterInput, client: ClientInfo): Promise<AuthResult> {
    const email = maskEmail(input.email);
    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existing) {
      this.logger.info({ email, ip: client.ip }, 'Registration rejected: email already registered');
      throw new AppException(
        'EMAIL_ALREADY_REGISTERED',
        'An account with this email already exists.',
      );
    }

    const passwordHash = await this.passwords.hash(input.password);
    const workspaceName = input.organization ?? `${input.fullName}'s workspace`;

    let user: User & { tenant: Tenant };
    try {
      user = await this.prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: {
            name: workspaceName,
            slug: `${slugify(workspaceName)}-${randomBytes(4).toString('hex')}`,
          },
        });
        return tx.user.create({
          data: {
            tenantId: tenant.id,
            email: input.email,
            passwordHash,
            fullName: input.fullName,
            organization: input.organization ?? null,
            role: 'OWNER',
            lastLoginAt: new Date(),
          },
          include: { tenant: true },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        this.logger.info({ email, ip: client.ip }, 'Registration rejected: concurrent sign-up');
        throw new AppException(
          'EMAIL_ALREADY_REGISTERED',
          'An account with this email already exists.',
        );
      }
      throw error;
    }

    const issued = await this.sessions.create(user.id, client);
    this.logger.info(
      {
        userId: user.id,
        tenantId: user.tenantId,
        email,
        sessionId: issued.session.id,
        ip: client.ip,
      },
      'User registered',
    );

    // The account exists either way; a queue outage must not fail the sign-up.
    await this.mailQueue
      .enqueueWelcome({
        userId: user.id,
        to: user.email,
        fullName: user.fullName,
        workspaceName: user.tenant.name,
      })
      .catch((error: unknown) => {
        this.logger.error({ err: error, userId: user.id }, 'Welcome email could not be queued');
      });

    return this.buildResult(user, issued);
  }

  async login(input: LoginInput, client: ClientInfo): Promise<AuthResult> {
    const email = maskEmail(input.email);
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      include: { tenant: true },
    });

    if (!user) {
      await this.passwords.verifyAgainstDummy(input.password);
      this.logger.warn({ reason: 'unknown-email', email, ip: client.ip }, 'Login failed');
      throw new AppException('INVALID_CREDENTIALS');
    }
    if (!(await this.passwords.verify(user.passwordHash, input.password))) {
      this.logger.warn(
        { reason: 'wrong-password', userId: user.id, tenantId: user.tenantId, ip: client.ip },
        'Login failed',
      );
      throw new AppException('INVALID_CREDENTIALS');
    }

    // After the password check, so a removed account answers exactly like a
    // wrong password and is no new signal to an attacker (ADR 0023).
    if (user.disabledAt) {
      this.logger.warn(
        { reason: 'disabled', userId: user.id, tenantId: user.tenantId, ip: client.ip },
        'Login failed',
      );
      throw new AppException('INVALID_CREDENTIALS');
    }

    const data: Prisma.UserUpdateInput = { lastLoginAt: new Date() };
    if (this.passwords.needsRehash(user.passwordHash)) {
      data.passwordHash = await this.passwords.hash(input.password);
      this.logger.info({ userId: user.id }, 'Password hash upgraded to current Argon2 parameters');
    }
    // Independent: the new session row only needs the user to already exist,
    // not this update to have landed (100M-row scale follow-up, docs/16 step 14).
    const [, issued] = await Promise.all([
      this.prisma.user.update({ where: { id: user.id }, data }),
      this.sessions.create(user.id, client),
    ]);
    this.logger.info(
      { userId: user.id, tenantId: user.tenantId, sessionId: issued.session.id, ip: client.ip },
      'Login succeeded',
    );
    return this.buildResult(user, issued);
  }

  async refresh(refreshToken: string, client: ClientInfo): Promise<AuthResult> {
    const issued = await this.sessions.rotate(refreshToken, client);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: issued.session.userId },
      include: { tenant: true },
    });
    return this.buildResult(user, issued);
  }

  async logout(refreshToken: string | undefined, client: ClientInfo): Promise<void> {
    const session = refreshToken ? await this.sessions.revoke(refreshToken, 'logout') : null;
    if (session) {
      this.logger.info(
        { userId: session.userId, sessionId: session.id, ip: client.ip },
        'Logged out',
      );
    } else {
      this.logger.debug({ ip: client.ip }, 'Logout without an active session');
    }
  }

  /** GET /auth/invitations/:token: shown before a password is chosen. */
  async invitationPreview(rawToken: string): Promise<InvitationPreview> {
    const tokenHash = hashInviteToken(this.config.SIGNING_TOKEN_SECRET, rawToken);
    const user = await this.prisma.user.findUnique({
      where: { inviteTokenHash: tokenHash },
      include: { tenant: { select: { name: true } } },
    });
    if (!user?.inviteTokenExpiresAt) throw new AppException('INVITE_TOKEN_INVALID');
    if (user.inviteTokenExpiresAt <= new Date()) throw new AppException('INVITE_TOKEN_EXPIRED');
    return {
      fullName: user.fullName,
      email: user.email,
      workspaceName: user.tenant.name,
      roleLabel: ROLE_LABEL[user.role],
      expiresAt: user.inviteTokenExpiresAt.toISOString(),
    };
  }

  /** Sets the chosen password, clears the invite, and signs the person in. */
  async acceptInvite(rawToken: string, password: string, client: ClientInfo): Promise<AuthResult> {
    const tokenHash = hashInviteToken(this.config.SIGNING_TOKEN_SECRET, rawToken);
    const found = await this.prisma.user.findUnique({
      where: { inviteTokenHash: tokenHash },
      include: { tenant: true },
    });
    if (!found?.inviteTokenExpiresAt) throw new AppException('INVITE_TOKEN_INVALID');
    if (found.inviteTokenExpiresAt <= new Date()) throw new AppException('INVITE_TOKEN_EXPIRED');

    const passwordHash = await this.passwords.hash(password);
    const user = await this.prisma.user.update({
      where: { id: found.id },
      data: {
        passwordHash,
        inviteTokenHash: null,
        inviteTokenExpiresAt: null,
        lastLoginAt: new Date(),
      },
      include: { tenant: true },
    });
    const issued = await this.sessions.create(user.id, client);
    this.logger.info(
      { userId: user.id, tenantId: user.tenantId, ip: client.ip },
      'Invitation accepted',
    );
    return this.buildResult(user, issued);
  }

  /**
   * POST /auth/password/forgot. The answer and its work are the same for a
   * registered, unknown, removed, service or pending address: a job is always
   * queued and the worker decides whether to send anything (ADR 0022).
   */
  async requestPasswordReset(email: string, client: ClientInfo): Promise<ForgotPasswordResponse> {
    this.logger.info({ email: maskEmail(email), ip: client.ip }, 'Password reset requested');
    // A queue outage must not turn into a different answer for a known address.
    await this.mailQueue.enqueuePasswordReset(email).catch((error: unknown) => {
      this.logger.error({ err: error }, 'Password reset email could not be queued');
    });
    return { message: FORGOT_PASSWORD_MESSAGE };
  }

  /**
   * POST /auth/password/change. The current password is checked again, so a
   * stolen session alone cannot change it. Every other session ends and this
   * one stays, so the person is not thrown out of the page they are on.
   */
  async changePassword(
    userId: string,
    sessionId: string,
    input: ChangePasswordInput,
    client: ClientInfo,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.disabledAt) throw new AppException('UNAUTHENTICATED');
    if (!(await this.passwords.verify(user.passwordHash, input.currentPassword))) {
      this.logger.warn(
        { reason: 'wrong-current-password', userId, tenantId: user.tenantId, ip: client.ip },
        'Password change rejected',
      );
      throw new AppException('CURRENT_PASSWORD_INCORRECT');
    }

    const passwordHash = await this.passwords.hash(input.newPassword);
    const now = new Date();
    const revokedSessions = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      const { count } = await tx.session.updateMany({
        where: { userId, revokedAt: null, id: { not: sessionId } },
        data: { revokedAt: now, revokedReason: 'password-change' satisfies RevokeReason },
      });
      return count;
    });
    this.logger.info(
      { userId, tenantId: user.tenantId, revokedSessions, ip: client.ip },
      'Password changed',
    );
    // The password has changed either way; a queue outage must not fail the request.
    await this.mailQueue.enqueuePasswordChanged(userId, 'change').catch((error: unknown) => {
      this.logger.error({ err: error, userId }, 'Password changed notice could not be queued');
    });
  }

  /** GET /auth/password/reset/:token: shown before a new password is chosen. */
  async passwordResetPreview(rawToken: string, client: ClientInfo): Promise<PasswordResetPreview> {
    const { token } = await this.findUsableResetToken(rawToken, client);
    return { email: maskEmail(token.user.email), expiresAt: token.expiresAt.toISOString() };
  }

  /**
   * POST /auth/password/reset/:token. One transaction: this link and every
   * other unused one are spent, the password changes, and every session of the
   * account ends. No new session is issued: the emailed link must not become a
   * login (ADR 0022).
   */
  async resetPassword(rawToken: string, password: string, client: ClientInfo): Promise<void> {
    const { token, ref } = await this.findUsableResetToken(rawToken, client);
    const userId = token.userId;
    const passwordHash = await this.passwords.hash(password);

    const now = new Date();
    const revokedSessions = await this.prisma.$transaction(async (tx) => {
      // The usedAt and expiry conditions make this safe against two requests
      // presenting the same link at once: only one claims it.
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: token.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count === 0) return null;
      const updated = await tx.user.updateMany({
        where: { id: userId, disabledAt: null },
        data: { passwordHash },
      });
      if (updated.count === 0) return null;
      await tx.passwordResetToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: now },
      });
      const { count } = await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'password-reset' satisfies RevokeReason },
      });
      return count;
    });
    if (revokedSessions === null) {
      this.logger.warn(
        { reason: 'raced-or-disabled', tokenRef: ref, ip: client.ip },
        'Password reset rejected',
      );
      throw new AppException('PASSWORD_RESET_TOKEN_INVALID');
    }

    this.logger.info(
      { userId, tenantId: token.user.tenantId, tokenRef: ref, revokedSessions, ip: client.ip },
      'Password reset completed',
    );
    // The password has changed either way; a queue outage must not fail the reset.
    await this.mailQueue.enqueuePasswordChanged(userId).catch((error: unknown) => {
      this.logger.error({ err: error, userId }, 'Password changed notice could not be queued');
    });
  }

  /** Finds a reset link that can still be used, or throws why it cannot (never the token itself). */
  private async findUsableResetToken(rawToken: string, client: ClientInfo) {
    const tokenHash = hashPasswordResetToken(this.config.SIGNING_TOKEN_SECRET, rawToken);
    const ref = tokenRef(tokenHash);
    const token = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    const reject = (
      reason: 'unknown' | 'used' | 'expired' | 'disabled',
      code: 'PASSWORD_RESET_TOKEN_INVALID' | 'PASSWORD_RESET_TOKEN_EXPIRED',
    ): never => {
      this.logger.warn({ reason, tokenRef: ref, ip: client.ip }, 'Password reset rejected');
      throw new AppException(code);
    };
    if (!token) return reject('unknown', 'PASSWORD_RESET_TOKEN_INVALID');
    if (token.usedAt) return reject('used', 'PASSWORD_RESET_TOKEN_INVALID');
    if (token.expiresAt <= new Date()) return reject('expired', 'PASSWORD_RESET_TOKEN_EXPIRED');
    if (token.user.disabledAt) return reject('disabled', 'PASSWORD_RESET_TOKEN_INVALID');
    return { token, ref };
  }

  async profile(userId: string): Promise<UserProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { tenant: true },
    });
    if (!user) throw new AppException('UNAUTHENTICATED');
    return toUserProfile(user);
  }

  private async buildResult(
    user: User & { tenant: Tenant },
    issued: IssuedSession,
  ): Promise<AuthResult> {
    const claims: AccessTokenClaims = {
      sub: user.id,
      tid: user.tenantId,
      sid: issued.session.id,
      // Baked in at issue time, like tid: a role change takes effect for this
      // user within one access-token lifetime (JWT_ACCESS_TTL_SECONDS), the
      // same bounded staleness a tenant change would have. Reading the role
      // fresh from the database on every request was the alternative, but
      // every route already pays one session-activity check per request
      // (SessionService.isActive); a second read for this would double it.
      role: user.role,
    };
    const accessToken = await this.jwt.signAsync(claims);
    return {
      refreshToken: issued.refreshToken,
      response: {
        accessToken,
        tokenType: 'Bearer',
        expiresIn: this.config.JWT_ACCESS_TTL_SECONDS,
        user: toUserProfile(user),
      },
    };
  }
}
