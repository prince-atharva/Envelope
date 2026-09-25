import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ApiKeyService } from './api-key.service';
import { ApiKeysController } from './api-keys.controller';

/** Tenant-scoped API keys (docs/08, docs/18). AuthModule exports PasswordService. */
@Module({
  imports: [AuthModule],
  controllers: [ApiKeysController],
  providers: [ApiKeyService],
})
export class ApiKeysModule {}
