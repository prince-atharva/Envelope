import { randomBytes } from 'node:crypto';
import type { AuthResponse, LoginInput, RegisterInput, UserProfile } from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppException } from '../common/errors/app-exception';
import { AppConfig } from '../config/app-config';
import { Prisma, type Tenant, type User } from '../generated/prisma/client';
import { maskEmail } from '../logging/redact';
import { MailQueueService } from '../mail/mail-queue.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AccessTokenClaims, ClientInfo } from './auth.types';
import { PasswordService } from './password.service';
import { type IssuedSession, SessionService } from './session.service';

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
