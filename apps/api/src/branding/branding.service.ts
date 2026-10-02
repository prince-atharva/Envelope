import { randomBytes, randomUUID } from 'node:crypto';
import type { BrandingSettings, UpdateBrandingInput } from '@envelope/shared';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AppException } from '../common/errors/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import { brandLogoKey, StorageService, type StoredObject } from '../storage/storage.service';
import { processBrandLogo } from './brand-logo';
import { toSigningBrand } from './signing-brand';

interface BrandedTenant {
  name: string;
  brandColor: string | null;
  brandLogoRef: string | null;
}

function toSettings(tenant: BrandedTenant): BrandingSettings {
  const brand = toSigningBrand(tenant);
  return { workspaceName: brand.name, color: brand.color, logoUrl: brand.logoUrl };
}

/**
 * Workspace logo and accent colour (docs/22 step 6, ADR 0034). Tenant-admin actions
 * with no envelope are structured logs, not audit rows (AGENTS.md section 7).
 */
@Injectable()
export class BrandingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @InjectPinoLogger(BrandingService.name) private readonly logger: PinoLogger,
  ) {}

  async get(tenantId: string): Promise<BrandingSettings> {
    return toSettings(await this.requireTenant(tenantId));
  }

  async update(input: UpdateBrandingInput, user: AuthenticatedUser): Promise<BrandingSettings> {
    const tenant = await this.prisma.tenant.update({
      where: { id: user.tenantId },
      data: { brandColor: input.color },
      select: { name: true, brandColor: true, brandLogoRef: true },
    });
    this.logger.info(
      { tenantId: user.tenantId, userId: user.id, colorSet: input.color !== null },
      'Workspace accent colour changed',
    );
    return toSettings(tenant);
  }

  async setLogo(bytes: Buffer, user: AuthenticatedUser): Promise<BrandingSettings> {
    const started = performance.now();
    const logo = await processBrandLogo(bytes);
    const key = brandLogoKey(user.tenantId, randomUUID());
    const ref = randomBytes(24).toString('base64url');

    // Written before the row points at it, so a failure leaves the old logo in place.
    await this.storage.put(key, logo.bytes, { contentType: 'image/png' });
    let previousKey: string | null;
    let tenant: BrandedTenant;
    try {
      const before = await this.requireTenant(user.tenantId);
      previousKey = before.brandLogoKey;
      tenant = await this.prisma.tenant.update({
        where: { id: user.tenantId },
        data: { brandLogoKey: key, brandLogoRef: ref },
        select: { name: true, brandColor: true, brandLogoRef: true },
      });
    } catch (error) {
      await this.storage.delete(key).catch(() => undefined);
      throw error;
    }
    if (previousKey) await this.deleteQuietly(previousKey, user.tenantId);

    this.logger.info(
      {
        tenantId: user.tenantId,
        userId: user.id,
        width: logo.width,
        height: logo.height,
        bytes: logo.bytes.length,
        durationMs: Math.round(performance.now() - started),
      },
      'Workspace logo replaced',
    );
    return toSettings(tenant);
  }

  async removeLogo(user: AuthenticatedUser): Promise<BrandingSettings> {
    const before = await this.requireTenant(user.tenantId);
    const tenant = await this.prisma.tenant.update({
      where: { id: user.tenantId },
      data: { brandLogoKey: null, brandLogoRef: null },
      select: { name: true, brandColor: true, brandLogoRef: true },
    });
    if (before.brandLogoKey) await this.deleteQuietly(before.brandLogoKey, user.tenantId);
    this.logger.info({ tenantId: user.tenantId, userId: user.id }, 'Workspace logo removed');
    return toSettings(tenant);
  }

  /** GET /branding/logo/:ref, public. An unknown or replaced reference is a plain 404. */
  async readLogo(ref: string): Promise<StoredObject> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { brandLogoRef: ref },
      select: { brandLogoKey: true },
    });
    if (!tenant?.brandLogoKey) throw new AppException('NOT_FOUND', 'Logo not found.');
    return this.storage.get(tenant.brandLogoKey);
  }

  private async requireTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, brandColor: true, brandLogoKey: true, brandLogoRef: true },
    });
    if (!tenant) throw new AppException('NOT_FOUND', 'Workspace not found.');
    return tenant;
  }

  /** The old object is only clutter once the row has moved on, so a failure is logged, not raised. */
  private async deleteQuietly(key: string, tenantId: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (error) {
      this.logger.warn(
        { tenantId, err: error instanceof Error ? error.message : 'unknown' },
        'Could not delete a replaced workspace logo',
      );
    }
  }
}
