import {
  type CreateEnvelopeInput,
  createEnvelopeSchema,
  DOCUMENT_CATEGORIES,
  ENVELOPE_STATUSES,
  ENVELOPE_VIEWS,
  type EnvelopeCounts,
  type EnvelopeDetail,
  type EnvelopeEventsResponse,
  type EnvelopeListResponse,
  type ListEnvelopeEventsQuery,
  type ListEnvelopesQuery,
  listEnvelopeEventsQuerySchema,
  listEnvelopesQuerySchema,
  MAX_UPLOAD_BYTES,
} from '@envelope/shared';
import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiProduces,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { Client, CurrentUser } from '../auth/auth.decorators';
import type { AuthenticatedUser, ClientInfo } from '../auth/auth.types';
import { ownerScopeOf } from '../auth/ownership';
import { AppException } from '../common/errors/app-exception';
import { LIMITS, RateLimit } from '../common/throttling/keyed-rate-limit.guard';
import { UuidParamPipe } from '../common/validation/uuid-param.pipe';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe';
import { EnvelopesService } from './envelopes.service';
import {
  TenantUploadRateLimitGuard,
  UploadErrorsInterceptor,
  UploadSizeGuard,
} from './upload.guards';

const documentQuerySchema = z.strictObject({
  version: z.coerce.number().int().min(0).default(0),
});

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

@ApiTags('envelopes')
@ApiBearerAuth()
@Controller('envelopes')
export class EnvelopesController {
  constructor(private readonly envelopes: EnvelopesService) {}

  @Post()
  @UseGuards(UploadSizeGuard, TenantUploadRateLimitGuard)
  @RateLimit(LIMITS.createAndSend)
  @UseInterceptors(
    UploadErrorsInterceptor,
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 4, fieldSize: 16 * 1024, parts: 6 },
    }),
  )
  @ApiOperation({
    summary: 'Upload a PDF and create a draft envelope',
    description:
      'The file goes through the upload-hardening pipeline (docs/10): size, PDF signature, ' +
      'structure, encryption, page count, malware scan and removal of active content.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'PDF, at most 25 MB and 500 pages' },
        title: { type: 'string', maxLength: 200 },
        documentCategory: { type: 'string', enum: [...DOCUMENT_CATEGORIES] },
        jurisdictionCode: { type: 'string', description: "Overrides the tenant's default" },
      },
    },
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Client() client: ClientInfo,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(createEnvelopeSchema)) body: CreateEnvelopeInput,
  ): Promise<EnvelopeDetail> {
    if (!file) {
      throw new AppException('FILE_REQUIRED', 'Send the PDF in the "file" form field.');
    }
    return this.envelopes.create(user, file, body, client);
  }

  @Get('counts')
  @ApiOperation({ summary: 'How many envelopes each dashboard view holds' })
  counts(@CurrentUser() user: AuthenticatedUser): Promise<EnvelopeCounts> {
    return this.envelopes.counts(user.tenantId, ownerScopeOf(user));
  }

  @Get()
  @ApiOperation({
    summary: 'List envelopes: Needs attention ranked by what to chase, other views newest first',
  })
  @ApiQuery({
    name: 'view',
    required: false,
    schema: { type: 'string', enum: [...ENVELOPE_VIEWS], default: 'all' },
  })
  @ApiQuery({
    name: 'status',
    required: false,
    schema: { type: 'string', enum: [...ENVELOPE_STATUSES] },
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100 },
  })
  @ApiQuery({ name: 'cursor', required: false, schema: { type: 'string' } })
  list(
    @Query(new ZodValidationPipe(listEnvelopesQuerySchema)) query: ListEnvelopesQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<EnvelopeListResponse> {
    return this.envelopes.list(query, user.tenantId, ownerScopeOf(user));
  }

  @Get(':id')
  @ApiOperation({ summary: 'An envelope with its document versions and audit trail' })
  async get(
    @Param('id', UuidParamPipe) id: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<EnvelopeDetail | undefined> {
    // Cheap to check on its own; a 304 answers the web's 15s poll (while an
    // envelope stays open) with no payload and none of the full detail's
    // queries (100M-row scale follow-up API pass, docs/16 step 14). Not
    // found here just means the full call below will say so.
    const scope = ownerScopeOf(user);
    const etag = await this.envelopes.getETag(id, scope);
    if (etag) {
      // `no-cache`, despite the name, means the browser DOES cache this —
      // it just always revalidates with the server (sending If-None-Match)
      // before using it, rather than ever serving it unchecked.
      res.set({ 'Cache-Control': 'private, no-cache', ETag: etag });
      if (ifNoneMatch === etag) {
        res.status(304).end();
        return undefined;
      }
    }
    return this.envelopes.get(id, scope);
  }

  @Get(':id/events')
  @ApiOperation({
    summary: 'The audit trail past what the detail carries, oldest first, paginated',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100 },
  })
  @ApiQuery({ name: 'cursor', required: false, schema: { type: 'string' } })
  events(
    @Param('id', UuidParamPipe) id: string,
    @Query(new ZodValidationPipe(listEnvelopeEventsQuerySchema)) query: ListEnvelopeEventsQuery,
  ): Promise<EnvelopeEventsResponse> {
    return this.envelopes.listEvents(id, query);
  }

  @Get(':id/file')
  @ApiOperation({ summary: 'Download a document version (default: version 0, the original)' })
  @ApiQuery({ name: 'version', required: false, schema: { type: 'integer', minimum: 0 } })
  @ApiProduces('application/pdf')
  async file(
    @Param('id', UuidParamPipe) id: string,
    @Query(new ZodValidationPipe(documentQuerySchema)) query: z.infer<typeof documentQuerySchema>,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile | undefined> {
    // A version's bytes never change once created, so this can be cached
    // aggressively; `private` (not `public`) because the route is still
    // authorized per tenant, not for a shared cache to serve to anyone
    // (100M-row scale follow-up API pass, docs/16 step 14). The ETag check
    // is answered from the cheap metadata lookup alone: a cache hit never
    // touches object storage.
    const meta = await this.envelopes.documentVersionMeta(id, query.version);
    const etag = `"${meta.sha256}"`;
    res.set({ 'Cache-Control': 'private, max-age=31536000, immutable', ETag: etag });
    if (ifNoneMatch === etag) {
      res.status(304).end();
      return undefined;
    }
    const document = await this.envelopes.openDocument(id, query.version);
    return new StreamableFile(document.body, {
      type: 'application/pdf',
      length: document.sizeBytes,
      disposition: contentDisposition(document.filename),
    });
  }
}
