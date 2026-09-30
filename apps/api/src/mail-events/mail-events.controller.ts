import { Body, Controller, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Public } from '../auth/auth.decorators';
import { AppException } from '../common/errors/app-exception';
import { AppConfig } from '../config/app-config';
import { adaptMailEvents, hasSecret, isMailEventAdapter } from './mail-event-adapters';
import { MailEventsService } from './mail-events.service';

/**
 * Where a mail provider reports bounces and spam complaints (docs/20, ADR 0029).
 * Not part of the partner API: a provider calls it, authenticated by the shared
 * secret in `MAIL_EVENTS_SECRET`. With no secret configured the route does not
 * exist, so delivery tracking is off until it is chosen.
 */
@ApiExcludeController()
@Controller('mail-events')
export class MailEventsController {
  constructor(
    private readonly config: AppConfig,
    private readonly events: MailEventsService,
    @InjectPinoLogger(MailEventsController.name) private readonly logger: PinoLogger,
  ) {}

  @Public()
  @Post(':adapter')
  @HttpCode(202)
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  async receive(
    @Param('adapter') adapter: string,
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
  ): Promise<{ events: number; recorded: number }> {
    const secret = this.config.MAIL_EVENTS_SECRET;
    if (!secret) throw new AppException('NOT_FOUND');
    if (!hasSecret(authorization, secret)) {
      this.logger.warn({ adapter }, 'Mail event refused: the secret did not match');
      throw new AppException('UNAUTHENTICATED');
    }
    if (!isMailEventAdapter(adapter)) throw new AppException('NOT_FOUND');

    const events = adaptMailEvents(adapter, body);
    let recorded = 0;
    for (const event of events) {
      if ((await this.events.record(event)) === 'recorded') recorded += 1;
    }
    this.logger.info({ adapter, events: events.length, recorded }, 'Mail events received');
    return { events: events.length, recorded };
  }
}
