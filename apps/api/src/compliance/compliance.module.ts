import { Module } from '@nestjs/common';
import { AuditExportController } from './audit-export.controller';
import { AuditExportService } from './audit-export.service';
import { JurisdictionService } from './jurisdiction.service';
import { LegalHoldController } from './legal-hold.controller';
import { LegalHoldService } from './legal-hold.service';

/**
 * Jurisdiction policy, legal hold and audit export (docs/17). Exports
 * `JurisdictionService`: `EnvelopesModule` imports this module so envelope
 * creation can resolve and freeze a policy.
 */
@Module({
  controllers: [LegalHoldController, AuditExportController],
  providers: [JurisdictionService, LegalHoldService, AuditExportService],
  exports: [JurisdictionService],
})
export class ComplianceModule {}
