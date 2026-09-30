import { Module } from '@nestjs/common';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { ComplianceModule } from '../compliance/compliance.module';
import { EnvelopesModule } from '../envelopes/envelopes.module';
import { SendingModule } from '../sending/sending.module';
import { TemplateEnvelopesService } from './template-envelopes.service';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

@Module({
  imports: [ComplianceModule, EnvelopesModule, SendingModule],
  controllers: [TemplatesController],
  providers: [TemplatesService, TemplateEnvelopesService, IdempotencyService],
  exports: [TemplatesService],
})
export class TemplatesModule {}
