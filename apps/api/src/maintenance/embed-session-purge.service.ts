import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service';
import type { SweepResult } from './expiry-sweep.service';
@Injectable()
export class EmbedSessionPurgeService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(EmbedSessionPurgeService.name) private readonly logger: PinoLogger,
  ) {}
  async run(now = new Date()): Promise<SweepResult> {
    const { count } = await this.prisma.embedSession.deleteMany({
      where: { expiresAt: { lt: new Date(now.getTime() - 7 * 86400_000) } },
    });
    if (count) this.logger.info({ purged: count }, 'Old embedded sessions purged');
    return { scanned: count, changed: count, failed: 0 };
  }
}
