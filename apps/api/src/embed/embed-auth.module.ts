import { Global, Module } from '@nestjs/common';
import { EmbedSessionService } from './embed-session.service';
@Global()
@Module({ providers: [EmbedSessionService], exports: [EmbedSessionService] })
export class EmbedAuthModule {}
