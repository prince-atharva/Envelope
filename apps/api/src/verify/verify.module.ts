import { Module } from '@nestjs/common';
import { VerifyController } from './verify.controller';
import { VerifyService } from './verify.service';

/** Public: POST /v1/verify. */
@Module({
  controllers: [VerifyController],
  providers: [VerifyService],
})
export class VerifyModule {}
