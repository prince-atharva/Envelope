import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { MailQueueService } from '../mail/mail-queue.service';
import { MailTransportService } from '../mail/mail-transport.service';
import { renderAlertEmail } from '../mail/templates';
import { AlertDelivery, type AlertMessage } from './alert.service';

/** The API queues the email; the worker sends it. */
@Injectable()
export class QueuedAlertDelivery extends AlertDelivery {
  constructor(private readonly mail: MailQueueService) {
    super();
  }

  async deliver(_to: string, alert: AlertMessage): Promise<void> {
    await this.mail.enqueueAlert(alert);
  }
}

/**
 * The worker sends straight through SMTP, not through its own queue: an alert
 * about a stuck or failing email queue would otherwise wait in that queue.
 */
@Injectable()
export class DirectAlertDelivery extends AlertDelivery {
  constructor(
    private readonly transport: MailTransportService,
    private readonly config: AppConfig,
  ) {
    super();
  }

  async deliver(to: string, alert: AlertMessage): Promise<void> {
    await this.transport.send(
      renderAlertEmail({ to, ...alert, appUrl: this.config.APP_URL }),
      'alert',
    );
  }
}
