import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/auth.decorators';
import { AppException } from '../common/errors/app-exception';
import { UuidParamPipe } from '../common/validation/uuid-param.pipe';
import { AppConfig } from '../config/app-config';
import { EmbedSessionService } from './embed-session.service';

@Controller('embed/frame')
export class EmbedFrameController {
  constructor(
    private readonly sessions: EmbedSessionService,
    private readonly config: AppConfig,
  ) {}
  @Get(':id')
  @Public()
  @ApiExcludeEndpoint()
  async frame(@Param('id', UuidParamPipe) id: string, @Res() response: Response): Promise<void> {
    const session = await this.sessions.frame(id);
    const root = this.config.NODE_ENV === 'test' ? 'apps/web/.e2e/web-dist' : 'apps/web/dist';
    let scripts = '';
    try {
      const manifest = JSON.parse(
        await readFile(path.join(this.config.APP_ROOT_DIR, root, '.vite/manifest.json'), 'utf8'),
      ) as Record<string, { file: string; css?: string[] }>;
      const entry = manifest['index.html'];
      if (!entry) throw new Error('Missing web entry');
      const asset = (name: string) => {
        if (!/^assets\/[A-Za-z0-9_.-]+$/.test(name)) throw new Error('Invalid web asset');
        return `/${name}`;
      };
      scripts = `${(entry.css ?? []).map((css) => `<link rel="stylesheet" href="${asset(css)}">`).join('')}<script type="module" src="${asset(entry.file)}"></script>`;
    } catch {
      if (this.config.NODE_ENV === 'production')
        throw new AppException(
          'SERVICE_UNAVAILABLE',
          'Build and deploy the Envelope web assets before opening the editor.',
        );
      scripts = '<script type="module" src="/embed-dev.js"></script>';
    }
    response.removeHeader('X-Frame-Options');
    response.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'${this.config.NODE_ENV === 'development' ? ' ws: wss:' : ''}; worker-src 'self' blob:; frame-ancestors ${session.parentOrigin}; base-uri 'none'; form-action 'self'`,
    });
    const bootstrap = JSON.stringify(session).replaceAll('<', '\\u003c');
    response.send(
      `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">${scripts}<title>Envelope editor</title></head><body><div id="root"></div><script type="application/json" id="embed-bootstrap">${bootstrap}</script></body></html>`,
    );
  }
}
