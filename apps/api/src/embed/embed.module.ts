import { Module } from '@nestjs/common';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { EnvelopesModule } from '../envelopes/envelopes.module';
import { EmbedController } from './embed.controller';
import { EmbedAuthModule } from './embed-auth.module';
import { EmbedFrameController } from './embed-frame.controller';
import { EmbedSdkController } from './embed-sdk.controller';
@Module({
  imports: [EmbedAuthModule, EnvelopesModule],
  controllers: [EmbedController, EmbedFrameController, EmbedSdkController],
  providers: [IdempotencyService],
})
export class EmbedModule {}
