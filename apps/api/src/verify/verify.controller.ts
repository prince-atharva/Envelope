import {
  MAX_UPLOAD_BYTES,
  VERIFY_REQUESTS_PER_MINUTE,
  type VerifyResponse,
} from '@envelope/shared';
import {
  Controller,
  HttpCode,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../auth/auth.decorators';
import { AppException } from '../common/errors/app-exception';
import { UploadErrorsInterceptor, UploadSizeGuard } from '../envelopes/upload.guards';
import { VerifyService } from './verify.service';

/** Anyone can check a copy: no account (docs/08, "Verification"). */
@ApiTags('verify')
@Public()
@Controller('verify')
export class VerifyController {
  constructor(private readonly verifier: VerifyService) {}

  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: VERIFY_REQUESTS_PER_MINUTE, ttl: 60_000 } })
  @UseGuards(UploadSizeGuard)
  @UseInterceptors(
    UploadErrorsInterceptor,
    // No storage option: multer keeps the file in memory, and it is never written anywhere.
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 0, parts: 1 },
    }),
  )
  @ApiOperation({ summary: 'Check whether a PDF is exactly a document signed here' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  async verify(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<VerifyResponse> {
    // The answer describes a private document: never cached.
    res.setHeader('Cache-Control', 'no-store');
    if (!file)
      throw new AppException('FILE_REQUIRED', 'Send exactly one PDF in the "file" form field.');
    return this.verifier.verify(file.buffer);
  }
}
