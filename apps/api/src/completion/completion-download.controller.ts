import type { DownloadRenewResponse } from '@envelope/shared';
import { Controller, Get, HttpCode, Param, Post, Res, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../auth/auth.decorators';
import { signedFilename } from '../mail/templates';
import { CompletionDownloadService } from './completion-download.service';

function attachment(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** The private link in a completion email, for a document too large to attach. */
@ApiTags('completion')
@Public()
@Controller('download/:token')
export class CompletionDownloadController {
  constructor(private readonly downloads: CompletionDownloadService) {}

  @Get()
  // Per address: a guessed token is 256 bits, so this only limits load.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Download a finished document with a completion email link' })
  @ApiParam({
    name: 'token',
    description: 'The token from the completion email. It is a credential: never log it.',
  })
  @ApiProduces('application/pdf')
  async download(
    @Param('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    // Personal and private, errors included: never cached, never in a Referer.
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const document = await this.downloads.open(token);
    return new StreamableFile(document.body, {
      type: 'application/pdf',
      length: document.sizeBytes,
      disposition: attachment(signedFilename(document.filename)),
    });
  }

  @Post('renew')
  @HttpCode(200)
  // Per address: generous enough for a genuine retry, tight enough to bound abuse.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Ask for a fresh link. The one route an expired download link can use.',
  })
  @ApiParam({
    name: 'token',
    description: 'The token from the completion email. It is a credential: never log it.',
  })
  async renew(@Param('token') token: string): Promise<DownloadRenewResponse> {
    return this.downloads.renew(token);
  }
}
