import { CLIENT_LOG_MAX_BYTES, type ClientLog, clientLogSchema } from '@digitalsign/shared';
import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBody, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Public } from '../auth/auth.decorators';
import { AppException } from '../common/errors/app-exception';
import { openApiSchema, ZodValidationPipe } from '../common/validation/zod-validation.pipe';
import { redactUrl } from '../logging/redact';

/**
 * Receives browser errors from the web app so they appear in the server logs
 * next to the API requests that led up to them. No authentication: errors on the
 * login page matter too. Size-capped and rate-limited instead.
 */
@ApiTags('client-logs')
@Public()
@Controller('client-logs')
export class ClientLogsController {
  constructor(@InjectPinoLogger(ClientLogsController.name) private readonly logger: PinoLogger) {}

  @Post()
  @HttpCode(204)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Report a browser error' })
  @ApiBody({ schema: openApiSchema(clientLogSchema) })
  @ApiNoContentResponse()
  report(@Req() req: Request, @Body(new ZodValidationPipe(clientLogSchema)) body: ClientLog): void {
    const declaredSize = Number(req.headers['content-length'] ?? 0);
    if (declaredSize > CLIENT_LOG_MAX_BYTES) {
      throw new AppException(
        'PAYLOAD_TOO_LARGE',
        `Error reports are limited to ${CLIENT_LOG_MAX_BYTES} bytes.`,
      );
    }

    const client = {
      source: body.source,
      url: redactUrl(body.url),
      stack: body.stack,
      lastRequestId: body.lastRequestId,
      userAgent: body.userAgent ?? req.headers['user-agent'],
      occurredAt: body.occurredAt,
    };
    this.logger[body.level](
      { origin: 'browser', client },
      `Browser ${body.level}: ${body.message}`,
    );
  }
}
