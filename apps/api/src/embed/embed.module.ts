import { Module } from '@nestjs/common';
import { EnvelopesModule } from '../envelopes/envelopes.module';
import { EmbedController } from './embed.controller';
import { EmbedAuthModule } from './embed-auth.module';
@Module({
  imports: [EmbedAuthModule, EnvelopesModule],
  controllers: [EmbedController],
})
export class EmbedModule {}
