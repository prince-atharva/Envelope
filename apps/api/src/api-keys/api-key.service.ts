import { createHmac, randomBytes } from 'node:crypto';
import type { ApiKeySummary, CreateApiKeyInput, CreateApiKeyResponse } from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { API_KEY_PREFIX } from '../auth/api-key.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PasswordService } from '../auth/password.service';
import { AppException } from '../common/errors/app-exception';
import { AppConfig } from '../config/app-config';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const DISPLAY_PREFIX_LENGTH = 12;

/** Every read of a key includes its own embed origins (docs/18 workstream 7, ADR 0017). */
const WITH_EMBED_ORIGINS = {
  embedOrigins: { select: { origin: true }, orderBy: { origin: 'asc' as const } },
};
type ApiKeyWithOrigins = Prisma.ApiKeyGetPayload<{ include: typeof WITH_EMBED_ORIGINS }>;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function toApiKeySummary(key: ApiKeyWithOrigins): ApiKeySummary {
  return {
    id: key.id,
    label: key.label,
    displayPrefix: key.displayPrefix,
    readOnly: key.readOnly,
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    revokedAt: key.revokedAt?.toISOString() ?? null,
    createdAt: key.createdAt.toISOString(),
    embedOrigins: key.embedOrigins.map((row) => row.origin),
  };
}

/**
 * Tenant-scoped API keys (docs/08, "Server integration"; docs/18, ADR 0015).
 * Every key acts as the tenant's one hidden `isServiceAccount` User, so it
 * reads and writes the whole tenant without `ownership.ts` needing a
 * non-human special case.
 */
@Injectable()
export class ApiKeyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly config: AppConfig,
    @InjectPinoLogger(ApiKeyService.name) private readonly logger: PinoLogger,
  ) {}

  private hash(rawKey: string): string {
    return createHmac('sha256', this.config.API_KEY_HASH_SECRET).update(rawKey).digest('hex');
  }

  async list(tenantId: string): Promise<ApiKeySummary[]> {
    const keys = await this.prisma.apiKey.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: WITH_EMBED_ORIGINS,
    });
    return keys.map(toApiKeySummary);
  }

  async create(input: CreateApiKeyInput, actor: AuthenticatedUser): Promise<CreateApiKeyResponse> {
    const actingUserId = await this.serviceAccountUserId(actor.tenantId);

    const rawKey = `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
    // A single nested create, so the key and its origins land atomically —
    // there is no window where the key exists without the origins the
    // caller asked for (docs/18 workstream 7, ADR 0017).
    const key = await this.prisma.apiKey.create({
      data: {
        tenantId: actor.tenantId,
        label: input.label,
        keyHash: this.hash(rawKey),
        displayPrefix: rawKey.slice(0, DISPLAY_PREFIX_LENGTH),
        readOnly: input.readOnly,
        actingUserId,
        createdByUserId: actor.id,
        embedOrigins: {
          create: input.embedOrigins.map((origin) => ({
            tenantId: actor.tenantId,
            origin,
            createdByUserId: actor.id,
          })),
        },
      },
      include: WITH_EMBED_ORIGINS,
    });

    this.logger.info(
      {
        apiKeyId: key.id,
        tenantId: actor.tenantId,
        createdBy: actor.id,
        readOnly: key.readOnly,
        embedOriginCount: key.embedOrigins.length,
      },
      'API key created',
    );
    return { apiKey: toApiKeySummary(key), rawKey };
  }

  async revoke(id: string, actor: AuthenticatedUser): Promise<ApiKeySummary> {
    const key = await this.prisma.apiKey.findFirst({
      where: { id, tenantId: actor.tenantId },
      include: WITH_EMBED_ORIGINS,
    });
    if (!key) throw new AppException('NOT_FOUND', 'API key not found.');
    if (key.revokedAt) return toApiKeySummary(key);

    const revoked = await this.prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
      include: WITH_EMBED_ORIGINS,
    });
    this.logger.info(
      { apiKeyId: id, tenantId: actor.tenantId, revokedBy: actor.id },
      'API key revoked',
    );
    return toApiKeySummary(revoked);
  }

  /**
   * Replaces a key's whole embedded-editor origin list (docs/18 workstream
   * 7, ADR 0017). Human ADMIN/OWNER JWT only — the controller route carries
   * no `@ApiKeyAllowed`/`@EmbedAllowed`, so an API key or embedded bearer is
   * refused before reaching here. A revoked key can't be edited: there is
   * nothing left for the origin list to authorize.
   */
  async setEmbedOrigins(
    id: string,
    origins: string[],
    actor: AuthenticatedUser,
  ): Promise<ApiKeySummary> {
    const key = await this.prisma.apiKey.findFirst({ where: { id, tenantId: actor.tenantId } });
    if (!key) throw new AppException('NOT_FOUND', 'API key not found.');
    if (key.revokedAt) throw new AppException('CONFLICT', 'This API key has been revoked.');
    if (key.readOnly && origins.length > 0) {
      throw new AppException(
        'API_KEY_READ_ONLY',
        'A read-only key cannot have embedded-editor origins.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Serialises two concurrent edits of the same key's origins; the same
      // idiom EmbedSessionService.setOrigins() used for the tenant-wide list.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 2))`;
      await tx.apiKeyEmbedOrigin.deleteMany({ where: { apiKeyId: id } });
      if (origins.length > 0) {
        await tx.apiKeyEmbedOrigin.createMany({
          data: origins.map((origin) => ({
            tenantId: actor.tenantId,
            apiKeyId: id,
            origin,
            createdByUserId: actor.id,
          })),
        });
      }
    });
    this.logger.info(
      { apiKeyId: id, tenantId: actor.tenantId, updatedBy: actor.id, count: origins.length },
      'API key embed origins updated',
    );
    const updated = await this.prisma.apiKey.findFirstOrThrow({
      where: { id },
      include: WITH_EMBED_ORIGINS,
    });
    return toApiKeySummary(updated);
  }

  /**
   * The tenant's hidden API-key principal (ADR 0015): `role: ADMIN`, an
   * unusable random password like an unaccepted invitation
   * (`users/users.service.ts`), never shown outside this module. Reused by
   * every key the tenant creates; provisioned lazily, on the first one.
   * Email uniqueness serialises a concurrent first creation: the loser of
   * the race simply re-reads the row the winner just created.
   */
  private async serviceAccountUserId(tenantId: string): Promise<string> {
    const existing = await this.prisma.user.findFirst({
      where: { tenantId, isServiceAccount: true },
      select: { id: true },
    });
    if (existing) return existing.id;

    const lockedPasswordHash = await this.passwords.hash(randomBytes(32).toString('hex'));
    try {
      const created = await this.prisma.user.create({
        data: {
          tenantId,
          email: `service-account+${tenantId}@internal.invalid`,
          fullName: 'API integration',
          role: 'ADMIN',
          passwordHash: lockedPasswordHash,
          isServiceAccount: true,
        },
        select: { id: true },
      });
      this.logger.info({ tenantId, userId: created.id }, 'Service-account user provisioned');
      return created.id;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const winner = await this.prisma.user.findFirstOrThrow({
        where: { tenantId, isServiceAccount: true },
        select: { id: true },
      });
      return winner.id;
    }
  }
}
