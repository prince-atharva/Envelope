import { randomBytes } from 'node:crypto';
import type {
  ChangeUserRoleInput,
  InviteUserInput,
  InviteUserResponse,
  TenantUser,
} from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PasswordService } from '../auth/password.service';
import { AppException } from '../common/errors/app-exception';
import { Prisma, type User } from '../generated/prisma/client';
import { maskEmail } from '../logging/redact';
import { MailQueueService } from '../mail/mail-queue.service';
import { PrismaService } from '../prisma/prisma.service';

function toTenantUser(user: User): TenantUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Users and roles, within one tenant (docs/17 step 6). OWNER only for every
 * write: doc 03's persona table gives Admin "Manages... users", but a
 * workspace's membership is deliberately the one thing even an admin cannot
 * change themselves.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly mailQueue: MailQueueService,
    @InjectPinoLogger(UsersService.name) private readonly logger: PinoLogger,
  ) {}

  async list(tenantId: string): Promise<TenantUser[]> {
    const users = await this.prisma.user.findMany({
      where: { tenantId },
      orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
    });
    return users.map(toTenantUser);
  }

  /**
   * Creates the account now, locked with an unusable random password until
   * the invitation is accepted (`auth/auth.service.ts#acceptInvite`), then
   * queues the email; the worker mints the real invite token (ADR 0009).
   */
  async invite(input: InviteUserInput, actor: AuthenticatedUser): Promise<InviteUserResponse> {
    const email = maskEmail(input.email);
    const lockedPasswordHash = await this.passwords.hash(randomBytes(32).toString('hex'));
    // Not a real token: the mailer overwrites this with one it mints itself
    // (ADR 0009). It exists only so `inviteTokenHash` is non-null between
    // creation and the worker's send, which is what
    // `UserInviteMailer#send()` reads to tell "pending" from "already
    // accepted" (both otherwise look identical: no live token). An HMAC
    // preimage is needed to ever pass this off as a valid token, so a
    // placeholder that was never itself the output of `mintInviteToken` is
    // safe to store.
    const pendingPlaceholder = randomBytes(32).toString('hex');

    let user: User;
    try {
      user = await this.prisma.user.create({
        data: {
          tenantId: actor.tenantId,
          email: input.email,
          fullName: input.fullName,
          role: input.role,
          passwordHash: lockedPasswordHash,
          inviteTokenHash: pendingPlaceholder,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        this.logger.info({ email }, 'Invite refused: email already registered');
        throw new AppException(
          'EMAIL_ALREADY_REGISTERED',
          'An account with this email already exists.',
        );
      }
      throw error;
    }

    await this.mailQueue.enqueueUserInvited(user.id).catch((error: unknown) => {
      this.logger.error({ err: error, userId: user.id }, 'Invitation email could not be queued');
    });

    this.logger.info(
      { userId: user.id, tenantId: actor.tenantId, role: user.role, invitedBy: actor.id, email },
      'User invited',
    );
    return { user: toTenantUser(user) };
  }

  async changeRole(
    userId: string,
    input: ChangeUserRoleInput,
    actor: AuthenticatedUser,
  ): Promise<TenantUser> {
    const target = await this.findInTenant(userId, actor.tenantId);
    if (target.role === 'OWNER' && input.role !== 'OWNER') {
      await this.assertNotLastOwner(actor.tenantId, userId);
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { role: input.role },
    });
    this.logger.info(
      { userId, tenantId: actor.tenantId, from: target.role, to: input.role, changedBy: actor.id },
      'User role changed',
    );
    return toTenantUser(updated);
  }

  async remove(userId: string, actor: AuthenticatedUser): Promise<void> {
    const target = await this.findInTenant(userId, actor.tenantId);
    if (userId === actor.id) {
      throw new AppException('BAD_REQUEST', 'You cannot remove yourself.');
    }
    if (target.role === 'OWNER') {
      await this.assertNotLastOwner(actor.tenantId, userId);
    }

    // Envelope.ownerId references this row with onDelete: Restrict, so a
    // user who has ever sent anything cannot be deleted outright — exactly
    // the protection that column already gives every envelope's evidence.
    // Downgrading to MEMBER and clearing credentials revokes access without
    // orphaning anything they sent.
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        role: 'MEMBER',
        passwordHash: await this.passwords.hash(randomBytes(32).toString('hex')),
        inviteTokenHash: null,
        inviteTokenExpiresAt: null,
      },
    });
    this.logger.info({ userId, tenantId: actor.tenantId, removedBy: actor.id }, 'User removed');
  }

  private async findInTenant(userId: string, tenantId: string): Promise<User> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId } });
    if (!user) throw new AppException('NOT_FOUND', 'User not found.');
    return user;
  }

  private async assertNotLastOwner(tenantId: string, excludingUserId: string): Promise<void> {
    const otherOwners = await this.prisma.user.count({
      where: { tenantId, role: 'OWNER', id: { not: excludingUserId } },
    });
    if (otherOwners === 0) {
      throw new AppException('LAST_OWNER', 'Every workspace needs at least one owner.');
    }
  }
}
