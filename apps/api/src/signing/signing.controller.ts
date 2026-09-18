import {
  type AdoptSignatureInput,
  type AdoptSignatureResponse,
  adoptSignatureSchema,
  type ConsentInput,
  type ConsentResponse,
  consentSchema,
  type DeclineInput,
  type DeclineResponse,
  declineSchema,
  type SigningSession,
  type SubmitSigningInput,
  type SubmitSigningResponse,
  submitSigningSchema,
} from '@envelope/shared';
import {
  Body,
  type CallHandler,
  Controller,
  type ExecutionContext,
  Get,
  HttpCode,
  Injectable,
  type NestInterceptor,
  Param,
  Post,
  StreamableFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiProduces, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { Observable } from 'rxjs';
import { Client, Public } from '../auth/auth.decorators';
import type { ClientInfo } from '../auth/auth.types';
import { openApiSchema, ZodValidationPipe } from '../common/validation/zod-validation.pipe';
import { SigningService } from './signing.service';
import { SigningRateLimitGuard } from './signing-rate-limit.guard';

/**
 * Signing responses are personal and short-lived: never cached by a browser or
 * a proxy, and never leaking the link through a Referer header (docs/10). Set
 * before the handler runs, so error responses carry them too.
 */
@Injectable()
class SignerResponseHeaders implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const res = context.switchToHttp().getResponse<Response>();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    return next.handle();
  }
}

const TOKEN_PARAM = {
  name: 'token',
  description: 'The token from the signing link. It is the signer’s only credential: never log it.',
};

/**
 * The public signing surface (docs/08). No account: the token in the path is
 * the only authority, and it is checked on every request (TokenGuardianService).
 *
 * Rate-limited per link rather than per address (SigningRateLimitGuard); the
 * global per-address limit is skipped, because many signers can share one
 * office network.
 */
@ApiTags('signing')
@Public()
@SkipThrottle()
@UseGuards(SigningRateLimitGuard)
@UseInterceptors(SignerResponseHeaders)
@Controller('sign/:token')
export class SigningController {
  constructor(private readonly signing: SigningService) {}

  @Get()
  @ApiOperation({ summary: 'Open a signing session (fields only after consent)' })
  @ApiParam(TOKEN_PARAM)
  session(@Param('token') token: string, @Client() client: ClientInfo): Promise<SigningSession> {
    return this.signing.session(token, client);
  }

  @Get('document')
  @ApiOperation({ summary: 'The document to sign (only after consent)' })
  @ApiParam(TOKEN_PARAM)
  @ApiProduces('application/pdf')
  async document(@Param('token') token: string): Promise<StreamableFile> {
    const document = await this.signing.document(token);
    return new StreamableFile(document.body, {
      type: 'application/pdf',
      length: document.sizeBytes,
      disposition: 'inline',
    });
  }

  @Post('consent')
  @HttpCode(200)
  @ApiOperation({ summary: 'Agree to sign electronically' })
  @ApiParam(TOKEN_PARAM)
  @ApiBody({ schema: openApiSchema(consentSchema) })
  consent(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(consentSchema)) body: ConsentInput,
    @Client() client: ClientInfo,
  ): Promise<ConsentResponse> {
    return this.signing.consent(token, body, client);
  }

  @Post('adopt')
  @HttpCode(200)
  @ApiOperation({ summary: 'Adopt a drawn or typed signature or initials' })
  @ApiParam(TOKEN_PARAM)
  @ApiBody({ schema: openApiSchema(adoptSignatureSchema) })
  adopt(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(adoptSignatureSchema)) body: AdoptSignatureInput,
    @Client() client: ClientInfo,
  ): Promise<AdoptSignatureResponse> {
    return this.signing.adopt(token, body, client);
  }

  @Post('submit')
  @HttpCode(202)
  @ApiOperation({ summary: 'Finish signing. The link stops working.' })
  @ApiParam(TOKEN_PARAM)
  @ApiBody({ schema: openApiSchema(submitSigningSchema) })
  submit(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(submitSigningSchema)) body: SubmitSigningInput,
    @Client() client: ClientInfo,
  ): Promise<SubmitSigningResponse> {
    return this.signing.submit(token, body, client);
  }

  @Post('decline')
  @HttpCode(200)
  @ApiOperation({ summary: 'Decline to sign, with a reason. Ends the envelope.' })
  @ApiParam(TOKEN_PARAM)
  @ApiBody({ schema: openApiSchema(declineSchema) })
  decline(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(declineSchema)) body: DeclineInput,
    @Client() client: ClientInfo,
  ): Promise<DeclineResponse> {
    return this.signing.decline(token, body, client);
  }
}
