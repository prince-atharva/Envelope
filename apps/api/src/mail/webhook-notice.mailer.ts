import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import type { WebhookDisabledJob } from './mail.types';
import { MailTransportService } from './mail-transport.service';
import type { SigningLinkResult } from './signing-link.mailer';
import { renderWebhookDisabledEmail } from './templates';

/** Emails about a tenant's webhook endpoints (docs/18 workstream 9). */
@Injectable()
export class WebhookNoticeMailer {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transport: MailTransportService,
    private readonly config: AppConfig,
    @InjectPinoLogger(WebhookNoticeMailer.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Skipped if the endpoint has been reactivated or removed since, or the
   * person is no longer an admin: the news would be stale or unwelcome.
   */
  async sendDisabled(job: WebhookDisabledJob): Promise<SigningLinkResult> {
    const endpoint = await this.prisma.webhookEndpoint.findUnique({
      where: { id: job.endpointId },
      include: { tenant: { select: { name: true } } },
    });
    if (!endpoint || endpoint.isActive || !endpoint.disabledAt) {
      this.logger.info(
        { endpointId: job.endpointId },
        'Webhook disabled notice not sent: endpoint no longer disabled',
      );
      return { skipped: 'endpoint no longer disabled' };
    }
    const user = await this.prisma.user.findFirst({
      where: {
        id: job.userId,
        tenantId: endpoint.tenantId,
        isServiceAccount: false,
        role: { in: ['OWNER', 'ADMIN'] },
      },
      select: { email: true, fullName: true },
    });
    if (!user) {
      this.logger.info(
        { endpointId: job.endpointId, userId: job.userId },
        'Webhook disabled notice not sent: recipient is not an admin',
      );
      return { skipped: 'recipient is not an admin' };
    }

    return this.transport.send(
      renderWebhookDisabledEmail({
        to: user.email,
        recipientName: user.fullName,
        workspaceName: endpoint.tenant.name,
        endpointHost: new URL(endpoint.url).hostname,
        failureThreshold: this.config.WEBHOOK_AUTO_DISABLE_THRESHOLD,
        settingsUrl: new URL('/settings/integrations', this.config.APP_URL).toString(),
      }),
      job.template,
    );
  }
}
