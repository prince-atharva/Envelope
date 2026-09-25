import { Module } from '@nestjs/common';
import { ComplianceModule } from '../compliance/compliance.module';
import { UploadsModule } from '../uploads/uploads.module';
import { EnvelopesController } from './envelopes.controller';
import { EnvelopesService } from './envelopes.service';
import { TenantUploadRateLimitGuard, UploadSizeGuard } from './upload.guards';

@Module({
  imports: [UploadsModule, ComplianceModule],
  controllers: [EnvelopesController],
  providers: [EnvelopesService, UploadSizeGuard, TenantUploadRateLimitGuard],
})
export class EnvelopesModule {}
