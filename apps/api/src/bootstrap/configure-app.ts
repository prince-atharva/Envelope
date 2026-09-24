import { BRAND } from '@envelope/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppConfig } from '../config/app-config';
import { NestLogger } from '../logging/nest-logger';
import { REQUEST_ID_HEADER, requestIdMiddleware } from '../logging/request-id.middleware';
import { APP_VERSION } from '../version';

export const API_PREFIX = 'api/v1';
export const DOCS_PATH = 'api/docs';

function parseTrustProxy(value: string): boolean | number | string {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

/**
 * Everything applied to the HTTP app, shared by main.ts and the e2e tests so both
 * run the exact same stack. The request-id middleware must be registered first.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(AppConfig);

  app.useLogger(app.get(NestLogger));
  app.flushLogs();

  app.set('trust proxy', parseTrustProxy(config.TRUST_PROXY));
  app.disable('x-powered-by');
  app.use(requestIdMiddleware);

  // Swagger UI needs inline scripts; every other route gets helmet's strict defaults.
  const strictHeaders = helmet();
  const docsHeaders = helmet({ contentSecurityPolicy: false });
  app.use((req: Request, res: Response, next: NextFunction) =>
    req.path.startsWith(`/${DOCS_PATH}`)
      ? docsHeaders(req, res, next)
      : strictHeaders(req, res, next),
  );
  app.use(cookieParser());

  // JSON responses only: PDFs are already compressed internally (gzipping
  // them again costs CPU for little to no size reduction), and 1 KB is
  // small enough that most of them clear it (100M-row scale follow-up API
  // pass, docs/16 step 14).
  app.use(
    compression({
      threshold: 1024,
      filter: (req, res) => {
        const contentType = res.getHeader('Content-Type');
        if (typeof contentType === 'string' && contentType.startsWith('application/pdf')) {
          return false;
        }
        return compression.filter(req, res);
      },
    }),
  );

  // Express defaults to 100 kB, which a full field layout can exceed: 1000
  // fields is roughly 250 kB of JSON. The cap still has to exist, because
  // parsing is done before any handler runs.
  app.useBodyParser('json', { limit: '1mb' });

  if (config.CORS_ORIGINS.length > 0) {
    app.enableCors({
      origin: config.CORS_ORIGINS,
      credentials: true,
      exposedHeaders: [REQUEST_ID_HEADER, 'Retry-After', 'ETag', 'Idempotency-Replayed'],
    });
  }

  app.setGlobalPrefix(API_PREFIX);

  if (config.API_DOCS_ENABLED ?? config.NODE_ENV !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle(`${BRAND.fullName} API`)
        .setDescription('Errors use RFC 7807 application/problem+json. See docs/08.')
        .setVersion(APP_VERSION)
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup(DOCS_PATH, app, document, {
      jsonDocumentUrl: `${DOCS_PATH}/openapi.json`,
    });
  }
}
