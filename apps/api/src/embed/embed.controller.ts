import {
  type CreateEmbedSessionInput,
  type CreateEnvelopeInput,
  createEmbedSessionSchema,
  createEnvelopeSchema,
  exchangeEmbedSessionSchema,
  MAX_UPLOAD_BYTES,
} from '@envelope/shared';
import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ApiKeyAllowed } from '../auth/api-key.decorator';
import { Client, CurrentUser, Public } from '../auth/auth.decorators';
import type { AuthenticatedUser, ClientInfo } from '../auth/auth.types';
import { AppException } from '../common/errors/app-exception';
import { RateLimit } from '../common/throttling/keyed-rate-limit.guard';
import { UuidParamPipe } from '../common/validation/uuid-param.pipe';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe';
import { EnvelopesService } from '../envelopes/envelopes.service';
import {
  TenantUploadRateLimitGuard,
  UploadErrorsInterceptor,
  UploadSizeGuard,
} from '../envelopes/upload.guards';
import { EmbedAllowed } from './embed.decorator';
import { EmbedSessionService } from './embed-session.service';

/**
 * Origin management moved to `PUT /api-keys/:id/embed-origins`
 * (docs/18 workstream 7, ADR 0017) — origins are a property of the issuing
 * key, not the tenant. This controller no longer serves `GET`/`PUT
 * /embed/origins`: those routes shipped in this same unreleased phase and
 * had no external caller, so they are removed outright rather than kept as
 * a deprecated shim.
 */
@Controller('embed')
export class EmbedController {
  constructor(
    private readonly sessions: EmbedSessionService,
    private readonly envelopes: EnvelopesService,
  ) {}
  @Post('sessions')
  @ApiKeyAllowed({ write: true })
  @RateLimit({ bucket: 'embed-issue', by: 'tenantKey', limit: 30 })
  issue(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createEmbedSessionSchema)) input: CreateEmbedSessionInput,
  ) {
    return this.sessions.issue(user, input);
  }
  @Post('sessions/exchange')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @RateLimit({ bucket: 'embed-exchange', by: 'embedLaunch', limit: 10 })
  exchange(
    @Body(new ZodValidationPipe(exchangeEmbedSessionSchema)) input: {
      sessionId: string;
      launchToken: string;
    },
  ) {
    return this.sessions.exchange(input.launchToken, input.sessionId);
  }
  @Delete('sessions/:id')
  @ApiKeyAllowed({ write: true })
  @HttpCode(204)
  @RateLimit({ bucket: 'embed-revoke', by: 'tenantKey', limit: 30 })
  revoke(@CurrentUser() user: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.sessions.revoke(user, id);
  }
  @Post('session/close')
  @EmbedAllowed('close')
  @HttpCode(204)
  @RateLimit({ bucket: 'embed-close', by: 'embed', limit: 10 })
  close(@CurrentUser() user: AuthenticatedUser) {
    if (!user.embed) throw new AppException('EMBED_SCOPE_DENIED');
    return this.sessions.revoke(user, user.embed.id);
  }
  @Post('session/envelope')
  @EmbedAllowed('upload')
  @RateLimit({ bucket: 'embed-upload', by: 'tenant', limit: 100 })
  @UseGuards(UploadSizeGuard, TenantUploadRateLimitGuard)
  @UseInterceptors(
    UploadErrorsInterceptor,
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 4, fieldSize: 16 * 1024, parts: 6 },
    }),
  )
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @Client() client: ClientInfo,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(createEnvelopeSchema)) input: CreateEnvelopeInput,
  ) {
    if (user.embed?.mode !== 'upload') throw new AppException('EMBED_SCOPE_DENIED');
    if (user.embed.envelopeId) return this.envelopes.get(user.embed.envelopeId);
    if (!file) throw new AppException('FILE_REQUIRED');
    return this.envelopes.create(user, file, input, client);
  }
}
