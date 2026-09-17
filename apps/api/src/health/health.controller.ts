import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../auth/auth.decorators';
import { type HealthReport, HealthService } from './health.service';

@ApiTags('health')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Readiness: 200 when every dependency is up, otherwise 503' })
  async readiness(@Res({ passthrough: true }) res: Response): Promise<HealthReport> {
    const report = await this.health.check();
    if (report.status !== 'ok') res.status(503);
    return report;
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness: 200 whenever the process is running' })
  liveness(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
