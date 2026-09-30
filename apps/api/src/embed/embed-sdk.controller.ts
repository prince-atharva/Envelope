import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../auth/auth.decorators';
import { AppException } from '../common/errors/app-exception';
import { AppConfig } from '../config/app-config';

const FILES = {
  'envelope.js': 'application/javascript; charset=utf-8',
  'envelope.mjs': 'text/javascript; charset=utf-8',
} as const;

interface CachedFile {
  mtimeMs: number;
  body: Buffer;
  etag: string;
}

/**
 * Serves the embed SDK to a partner's page (docs/18 workstream 12, ADR 0020). A partner's browser
 * loads it cross-origin, so it needs `Cross-Origin-Resource-Policy: cross-origin` (helmet's default
 * `same-origin` would silently block the load) and, for `<script type="module">`, an
 * `Access-Control-Allow-Origin`. It carries no secret, so `*` is safe.
 */
@Controller('embed/sdk')
export class EmbedSdkController {
  private readonly cache = new Map<string, CachedFile>();

  constructor(private readonly config: AppConfig) {}

  @Get('v1/:file')
  @Public()
  @ApiExcludeEndpoint()
  async serve(
    @Param('file') file: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    if (!Object.hasOwn(FILES, file)) throw new AppException('NOT_FOUND');
    const built = await this.load(file);
    response.set({
      'Content-Type': FILES[file as keyof typeof FILES],
      'Cache-Control': 'public, max-age=300',
      ETag: built.etag,
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Access-Control-Allow-Origin': '*',
    });
    if (request.headers['if-none-match'] === built.etag) {
      response.status(304).end();
      return;
    }
    response.send(built.body);
  }

  private async load(file: string): Promise<CachedFile> {
    const location = path.join(this.config.APP_ROOT_DIR, 'packages/embed/dist', file);
    try {
      const { mtimeMs } = await stat(location);
      const cached = this.cache.get(file);
      if (cached && cached.mtimeMs === mtimeMs) return cached;
      const body = await readFile(location);
      const etag = `"sha256-${createHash('sha256').update(body).digest('base64url')}"`;
      const fresh = { mtimeMs, body, etag };
      this.cache.set(file, fresh);
      return fresh;
    } catch {
      throw new AppException(
        'SERVICE_UNAVAILABLE',
        'The embed SDK is not built. Run `pnpm --filter @envelope/embed build` and deploy packages/embed/dist.',
      );
    }
  }
}
