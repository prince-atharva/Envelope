import { createHmac, randomBytes } from 'node:crypto';
import {
  type CreateEmbedSessionInput,
  type CreateEmbedSessionResponse,
  EMBED_ACCESS_PREFIX,
  EMBED_LAUNCH_PREFIX,
  EMBED_LAUNCH_TTL_MS,
  EMBED_SESSION_TTL_MS,
  type EmbedSessionResponse,
} from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AppException } from '../common/errors/app-exception';
import type { RequestContext } from '../common/request-context';
import { AppConfig } from '../config/app-config';
import type { EmbedSession } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class EmbedSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly cls: ClsService<RequestContext>,
    @InjectPinoLogger(EmbedSessionService.name) private readonly logger: PinoLogger,
  ) {}

  hash(token: string): string {
    return createHmac('sha256', this.config.EMBED_SESSION_HASH_SECRET).update(token).digest('hex');
  }
  /**
   * One key's own approved origins (docs/18 workstream 7, ADR 0017) — never
   * the tenant-wide list, so two keys in one tenant have independent iframe
   * permissions even though both act as the same tenant's ADMIN scope.
   */
  private async apiKeyOrigins(apiKeyId: string): Promise<string[]> {
    return (
      await this.prisma.apiKeyEmbedOrigin.findMany({
        where: { apiKeyId },
        select: { origin: true },
      })
    ).map((row) => row.origin);
  }
  async issue(
    user: AuthenticatedUser,
    input: CreateEmbedSessionInput,
  ): Promise<CreateEmbedSessionResponse> {
    if (!user.apiKeyId || user.embed) throw new AppException('EMBED_SCOPE_DENIED');
    if (!(await this.apiKeyOrigins(user.apiKeyId)).includes(input.parentOrigin))
      throw new AppException('EMBED_ORIGIN_NOT_ALLOWED');
    if (input.mode === 'existing') {
      const envelope = await this.prisma.envelope.findFirst({
        where: { id: input.envelopeId, tenantId: user.tenantId },
        select: { status: true },
      });
      if (!envelope) throw new AppException('NOT_FOUND');
      if (envelope.status !== 'DRAFT') throw new AppException('ENVELOPE_NOT_DRAFT');
    }
    const launchToken = EMBED_LAUNCH_PREFIX + randomBytes(32).toString('hex');
    const now = Date.now();
    const row = await this.prisma.embedSession.create({
      data: {
        tenantId: user.tenantId,
        apiKeyId: user.apiKeyId,
        actingUserId: user.id,
        mode: input.mode,
        envelopeId: input.mode === 'existing' ? input.envelopeId : null,
        parentOrigin: input.parentOrigin,
        externalActorId: input.externalActorId,
        actions: input.actions,
        ...(input.mode === 'upload'
          ? {
              externalId: input.externalId,
              ...(input.metadata ? { metadata: input.metadata } : {}),
            }
          : {}),
        launchTokenHash: this.hash(launchToken),
        launchExpiresAt: new Date(now + EMBED_LAUNCH_TTL_MS),
        expiresAt: new Date(now + EMBED_SESSION_TTL_MS),
      },
    });
    this.logger.info(
      { tenantId: user.tenantId, embedSessionId: row.id, envelopeId: row.envelopeId },
      'Embedded session issued',
    );
    return this.issued(row, launchToken);
  }

  private issued(row: EmbedSession, launchToken: string): CreateEmbedSessionResponse {
    return {
      sessionId: row.id,
      launchToken,
      launchExpiresAt: row.launchExpiresAt.toISOString(),
      frameUrl: `${this.config.APP_URL.replace(/\/$/, '')}/api/v1/embed/frame/${row.id}`,
    };
  }

  /**
   * A replayed `POST /embed/sessions` (docs/18 workstream 10, ADR 0019): a new
   * launch token for the session the first request created, since that one was
   * never stored and may be spent. Only for the issuing key, and only while the
   * session has not been opened — once redeemed there is no launch to repeat.
   * The old token stops working at once: its hash is replaced, not added to.
   */
  async reissueLaunch(
    user: AuthenticatedUser,
    sessionId: string,
  ): Promise<CreateEmbedSessionResponse> {
    if (!user.apiKeyId || user.embed) throw new AppException('EMBED_SCOPE_DENIED');
    const launchToken = EMBED_LAUNCH_PREFIX + randomBytes(32).toString('hex');
    const now = new Date();
    const where = {
      id: sessionId,
      tenantId: user.tenantId,
      apiKeyId: user.apiKeyId,
    };
    const updated = await this.prisma.embedSession.updateMany({
      where: { ...where, redeemedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: {
        launchTokenHash: this.hash(launchToken),
        launchExpiresAt: new Date(now.getTime() + EMBED_LAUNCH_TTL_MS),
      },
    });
    if (!updated.count) {
      const row = await this.prisma.embedSession.findFirst({ where });
      if (!row) throw new AppException('NOT_FOUND');
      if (row.revokedAt) throw new AppException('EMBED_SESSION_INVALID');
      if (row.redeemedAt) throw new AppException('EMBED_LAUNCH_USED');
      throw new AppException('EMBED_SESSION_EXPIRED');
    }
    const row = await this.prisma.embedSession.findFirstOrThrow({ where });
    this.logger.info(
      { tenantId: user.tenantId, embedSessionId: row.id },
      'Embedded session launch token reissued',
    );
    return this.issued(row, launchToken);
  }
  private async assertActive(row: EmbedSession | null): Promise<EmbedSession> {
    if (!row || row.revokedAt) throw new AppException('EMBED_SESSION_INVALID');
    if (row.expiresAt.getTime() <= Date.now()) throw new AppException('EMBED_SESSION_EXPIRED');
    const [key, origin] = await Promise.all([
      this.prisma.apiKey.findFirst({
        where: { id: row.apiKeyId, tenantId: row.tenantId, revokedAt: null, readOnly: false },
        select: { id: true },
      }),
      this.prisma.apiKeyEmbedOrigin.findFirst({
        where: { apiKeyId: row.apiKeyId, origin: row.parentOrigin },
        select: { id: true },
      }),
    ]);
    if (!key || !origin) throw new AppException('EMBED_SESSION_INVALID');
    return row;
  }
  async frame(sessionId: string): Promise<{ sessionId: string; parentOrigin: string }> {
    const row = await this.assertActive(
      await this.prisma.embedSession.findUnique({ where: { id: sessionId } }),
    );
    if (!row.redeemedAt && row.launchExpiresAt.getTime() <= Date.now())
      throw new AppException('EMBED_SESSION_EXPIRED');
    return { sessionId: row.id, parentOrigin: row.parentOrigin };
  }
  async exchange(launchToken: string, sessionId: string): Promise<EmbedSessionResponse> {
    const row = await this.assertActive(
      await this.prisma.embedSession.findUnique({
        where: { launchTokenHash: this.hash(launchToken) },
      }),
    );
    if (row.id !== sessionId) throw new AppException('EMBED_SESSION_INVALID');
    if (row.redeemedAt) throw new AppException('EMBED_LAUNCH_USED');
    if (row.launchExpiresAt.getTime() <= Date.now())
      throw new AppException('EMBED_SESSION_EXPIRED');
    const accessToken = EMBED_ACCESS_PREFIX + randomBytes(32).toString('hex');
    const updated = await this.prisma.embedSession.updateMany({
      where: {
        id: row.id,
        tenantId: row.tenantId,
        redeemedAt: null,
        revokedAt: null,
        launchExpiresAt: { gt: new Date() },
      },
      data: { redeemedAt: new Date(), accessTokenHash: this.hash(accessToken) },
    });
    if (!updated.count) throw new AppException('EMBED_LAUNCH_USED');
    this.logger.info(
      { embedSessionId: row.id, tenantId: row.tenantId },
      'Embedded launch redeemed',
    );
    return {
      accessToken,
      expiresAt: row.expiresAt.toISOString(),
      envelopeId: row.envelopeId,
      mode: row.mode as 'existing' | 'upload',
      actions: row.actions as ('edit' | 'send')[],
    };
  }
  async authenticate(token: string): Promise<AuthenticatedUser> {
    if (!/^eea_[a-f0-9]{64}$/.test(token)) throw new AppException('EMBED_SESSION_INVALID');
    const row = await this.assertActive(
      await this.prisma.embedSession.findUnique({ where: { accessTokenHash: this.hash(token) } }),
    );
    if (!row.redeemedAt) throw new AppException('EMBED_SESSION_INVALID');
    const user: AuthenticatedUser = {
      id: row.actingUserId,
      tenantId: row.tenantId,
      sessionId: row.id,
      role: 'ADMIN',
      embed: {
        id: row.id,
        envelopeId: row.envelopeId,
        mode: row.mode,
        actions: row.actions,
        externalActorId: row.externalActorId,
      },
    };
    this.cls.set('userId', user.id);
    this.cls.set('tenantId', user.tenantId);
    this.cls.set('sessionId', row.id);
    this.cls.set('embedActor', { embedSessionId: row.id, externalActorId: row.externalActorId });
    this.logger.assign({ tenantId: row.tenantId, embedSessionId: row.id });
    return user;
  }
  async revoke(user: AuthenticatedUser, id: string): Promise<void> {
    if (!user.embed && !user.apiKeyId) throw new AppException('EMBED_SCOPE_DENIED');
    const where = user.embed
      ? { id: user.embed.id, tenantId: user.tenantId }
      : { id, tenantId: user.tenantId, apiKeyId: user.apiKeyId ?? '' };
    const updated = await this.prisma.embedSession.updateMany({
      where,
      data: { revokedAt: new Date() },
    });
    if (!updated.count) throw new AppException('NOT_FOUND');
    this.logger.info({ tenantId: user.tenantId, embedSessionId: id }, 'Embedded session revoked');
  }
}
