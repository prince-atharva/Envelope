import { Module } from '@nestjs/common';
import { UploadsModule } from '../uploads/uploads.module';
import { EnvelopesController } from './envelopes.controller';
import { EnvelopesService } from './envelopes.service';
import { TenantUploadRateLimitGuard, UploadSizeGuard } from './upload.guards';

@Module({
  imports: [UploadsModule],
  controllers: [EnvelopesController],
  providers: [EnvelopesService, UploadSizeGuard, TenantUploadRateLimitGuard],
})
export class EnvelopesModule {}
