import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service';
import type { SweepResult } from './expiry-sweep.service';

const DAY_MS = 24 * 3600 * 1000;
/** "Failed deliveries are retained 7 days" (docs/08, "Delivery"; docs/18). */
const RETENTION_DAYS = 7;

/**
 * Removes `WebhookDelivery` rows older than the 7-day retention window
 * docs/08 documents for failed deliveries — applied uniformly to every
 * status, since a delivery log is operational, not evidence (unlike
 * `AuditTrail`, ADR 0004): nothing depends on a successful delivery's row
 * surviving past its usefulness for debugging.
 */
@Injectable()
export class WebhookDeliveryPurgeService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(WebhookDeliveryPurgeService.name) private readonly logger: PinoLogger,
  ) {}

  async run(now = new Date()): Promise<SweepResult> {
    const cutoff = new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
    const { count } = await this.prisma.webhookDelivery.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    if (count > 0) {
      this.logger.info({ purged: count }, 'Old webhook deliveries purged');
    }
    // A finished rotation overlap window: the previous secret no longer signs
    // anything, so it should not stay stored (docs/18 workstream 9).
    const { count: cleared } = await this.prisma.webhookEndpoint.updateMany({
      where: { previousSecretExpiresAt: { lt: now } },
      data: { previousSecretCiphertext: null, previousSecretExpiresAt: null },
    });
    if (cleared > 0) {
      this.logger.info({ cleared }, 'Expired webhook previous secrets cleared');
    }
    return { scanned: count, changed: count, failed: 0 };
  }
}
