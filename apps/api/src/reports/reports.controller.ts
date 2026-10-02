import { type ReportQuery, type ReportSummary, reportQuerySchema } from '@envelope/shared';
import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { Roles } from '../auth/roles.decorator';
import { LIMITS, RateLimit } from '../common/throttling/keyed-rate-limit.guard';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe';
import { ReportsService } from './reports.service';

/** Reports (docs/22 step 9). Admins and owners, JWT only: not `@ApiKeyAllowed`, not `@EmbedAllowed`. */
@ApiTags('reports')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('summary')
  @RateLimit(LIMITS.reports)
  @ApiOperation({
    summary:
      'Sent, completed and drop-off numbers for the workspace over a window of up to 366 days',
  })
  @ApiQuery({ name: 'from', required: false, description: 'First day, YYYY-MM-DD (UTC)' })
  @ApiQuery({ name: 'to', required: false, description: 'Last day, YYYY-MM-DD (UTC)' })
  summary(
    @Query(new ZodValidationPipe(reportQuerySchema)) query: ReportQuery,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReportSummary> {
    return this.reports.summary(user.tenantId, query);
  }
}
