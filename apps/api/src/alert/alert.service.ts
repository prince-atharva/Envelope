import { Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfig, SERVICE_NAME, type ServiceName } from '../config/app-config';
import type { AlertFields } from '../mail/mail.types';
import { RedisService } from '../redis/redis.service';

/** An alert about to be emailed. */
export interface AlertMessage {
  key: string;
  summary: string;
  fields: AlertFields;
  service: ServiceName;
  raisedAt: Date;
}

/** How an alert email leaves this process: queued by the API, sent directly by the worker. */
export abstract class AlertDelivery {
  abstract deliver(to: string, alert: AlertMessage): Promise<void>;
}

/**
 * Urgent problems that need a person (docs/16 step 11).
 *
 * Every alert is logged as an error with `alert: true`, which is what log
 * monitoring watches. With ALERT_EMAIL set it is also emailed, at most once
 * per key every ALERT_EMAIL_MIN_INTERVAL_MINUTES: a Redis `SET NX PX` gate
 * shared by every process, so a failure repeating in a loop sends one email,
 * not thousands.
 *
 * Raising an alert never throws: it runs where something has already gone
 * wrong, and must not make that worse.
 */
@Injectable()
export class AlertService {
  constructor(
    private readonly config: AppConfig,
    private readonly redis: RedisService,
    private readonly delivery: AlertDelivery,
    @Inject(SERVICE_NAME) private readonly service: ServiceName,
    @InjectPinoLogger(AlertService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * @param key Identifies the problem for the email gate, e.g. `seal-job-failed`.
   * @param summary One line a person can act on.
   * @param fields Ids, codes and counts only: never names, emails, reasons or tokens.
   * @param err The error behind it, for the log line only; it is never emailed.
   */
  async raise(
    key: string,
    summary: string,
    fields: AlertFields = {},
    err?: unknown,
  ): Promise<void> {
    this.logger.error({ alert: true, alertKey: key, ...fields, err }, summary);

    const to = this.config.ALERT_EMAIL;
    if (!to) return;
    try {
      const gate = await this.redis.client.set(
        `${this.config.QUEUE_PREFIX}:alert-gate:${key}`,
        '1',
        'PX',
        this.config.ALERT_EMAIL_MIN_INTERVAL_MINUTES * 60_000,
        'NX',
      );
      if (gate !== 'OK') {
        this.logger.debug({ alertKey: key }, 'Alert email held back: sent recently');
        return;
      }
      await this.delivery.deliver(to, {
        key,
        summary,
        fields,
        service: this.service,
        raisedAt: new Date(),
      });
      this.logger.info({ alertKey: key }, 'Alert emailed');
    } catch (error) {
      this.logger.error({ err: error, alertKey: key }, 'Alert could not be emailed');
    }
  }
}
