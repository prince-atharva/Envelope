import { Module } from '@nestjs/common';
import { EnvelopesModule } from '../envelopes/envelopes.module';
import { EmbedController } from './embed.controller';
import { EmbedAuthModule } from './embed-auth.module';
import { EmbedFrameController } from './embed-frame.controller';
@Module({
  imports: [EmbedAuthModule, EnvelopesModule],
  controllers: [EmbedController, EmbedFrameController],
})
export class EmbedModule {}
