import {
  BRAND_LOGO_MAX_BYTES,
  type BrandingSettings,
  type UpdateBrandingInput,
  updateBrandingSchema,
} from '@envelope/shared';
import {
  Body,
  type CallHandler,
  Controller,
  Delete,
  type ExecutionContext,
  Get,
  HttpException,
  Injectable,
  type NestInterceptor,
  Param,
  Patch,
  Put,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { catchError, type Observable, throwError } from 'rxjs';
import { CurrentUser, Public } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { Roles } from '../auth/roles.decorator';
import { AppException } from '../common/errors/app-exception';
import { LIMITS, RateLimit } from '../common/throttling/keyed-rate-limit.guard';
import { openApiSchema, ZodValidationPipe } from '../common/validation/zod-validation.pipe';
import { BrandingService } from './branding.service';

/** A multipart error on the logo upload is the logo's problem, not a PDF's (docs/22 step 6). */
@Injectable()
class LogoUploadErrorsInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        const tooLarge =
          (error instanceof Error &&
            error.name === 'MulterError' &&
            (error as Error & { code?: string }).code === 'LIMIT_FILE_SIZE') ||
          (error instanceof HttpException && error.getStatus() === 413);
        if (tooLarge) {
          return throwError(
            () =>
              new AppException(
                'INVALID_BRAND_LOGO',
                `The logo is larger than ${Math.round(BRAND_LOGO_MAX_BYTES / 1024)} KB.`,
              ),
          );
        }
        const malformed =
          (error instanceof Error && error.name === 'MulterError') ||
          (error instanceof HttpException && error.getStatus() === 400);
        return throwError(() =>
          malformed ? new AppException('INVALID_BRAND_LOGO', 'Choose one image file.') : error,
        );
      }),
    );
  }
}

/** Settings -> Branding (docs/22 step 6, ADR 0034). Admins and owners; JWT only, never an API key. */
@ApiTags('branding')
@Controller('branding')
export class BrandingController {
  constructor(private readonly branding: BrandingService) {}

  @Get()
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: "The workspace's accent colour and logo" })
  get(@CurrentUser() user: AuthenticatedUser): Promise<BrandingSettings> {
    return this.branding.get(user.tenantId);
  }

  @Patch()
  @Roles('ADMIN')
  @RateLimit(LIMITS.branding)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set or clear the accent colour (white text must stay readable on it)' })
  @ApiBody({ schema: openApiSchema(updateBrandingSchema) })
  update(
    @Body(new ZodValidationPipe(updateBrandingSchema)) body: UpdateBrandingInput,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BrandingSettings> {
    return this.branding.update(body, user);
  }

  @Put('logo')
  @Roles('ADMIN')
  @RateLimit(LIMITS.branding)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set or replace the logo (PNG or JPEG, up to 512 KB)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(
    LogoUploadErrorsInterceptor,
    FileInterceptor('file', { limits: { fileSize: BRAND_LOGO_MAX_BYTES, files: 1, fields: 0 } }),
  )
  setLogo(
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BrandingSettings> {
    if (!file) throw new AppException('INVALID_BRAND_LOGO', 'Choose an image file.');
    return this.branding.setLogo(file.buffer, user);
  }

  @Delete('logo')
  @Roles('ADMIN')
  @RateLimit(LIMITS.branding)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove the logo' })
  removeLogo(@CurrentUser() user: AuthenticatedUser): Promise<BrandingSettings> {
    return this.branding.removeLogo(user);
  }

  /**
   * Public: email clients fetch images without cookies. The reference is random and
   * changes on every upload, so the response can be cached forever and the tenant id
   * never appears in a URL (ADR 0034).
   */
  @Get('logo/:ref')
  @Public()
  @ApiOperation({ summary: "A workspace's logo, by its public reference" })
  @ApiParam({ name: 'ref', description: 'The random reference in the logo URL' })
  @ApiProduces('image/png')
  async logo(
    @Param('ref') ref: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const object = await this.branding.readLogo(ref.slice(0, 64));
    res.set({
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      // Helmet's default blocks other origins; a mail client loads this image from its own.
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    return new StreamableFile(object.body);
  }
}
