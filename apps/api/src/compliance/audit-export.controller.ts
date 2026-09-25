import {
  type AuditExportDocument,
  type AuditExportQuery,
  auditExportQuerySchema,
} from '@envelope/shared';
import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Client, CurrentUser } from '../auth/auth.decorators';
import type { AuthenticatedUser, ClientInfo } from '../auth/auth.types';
import { Roles } from '../auth/roles.decorator';
import { UuidParamPipe } from '../common/validation/uuid-param.pipe';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe';
import { AuditExportService, toCsv } from './audit-export.service';

/**
 * Audit export (docs/17 step 9, AUD-06). JSON is self-sufficient: anyone
 * with the file, and no access to this platform, can re-verify the chain
 * (docs/adr/0004-hash-chain-the-audit-trail.md). CSV carries the same rows
 * for a human reader, without the hashes. ADMIN or OWNER only.
 */
@ApiTags('compliance')
@ApiBearerAuth()
@Controller('envelopes')
export class AuditExportController {
  constructor(private readonly exports: AuditExportService) {}

  @Get(':id/audit')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Export the audit trail: JSON re-verifies offline, CSV is for reading' })
  @ApiQuery({ name: 'format', required: false, schema: { type: 'string', enum: ['json', 'csv'] } })
  @ApiProduces('application/json', 'text/csv')
  async export(
    @Param('id', UuidParamPipe) id: string,
    @Query(new ZodValidationPipe(auditExportQuerySchema)) query: AuditExportQuery,
    @CurrentUser() user: AuthenticatedUser,
    @Client() client: ClientInfo,
    @Res() res: Response,
  ): Promise<void> {
    const doc: AuditExportDocument = await this.exports.export(id, user, client);
    if (query.format === 'csv') {
      res.set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="audit-${id}.csv"`,
      });
      res.status(200).send(toCsv(doc));
      return;
    }
    res.set({
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="audit-${id}.json"`,
    });
    res.status(200).send(JSON.stringify(doc, null, 2));
  }
}
