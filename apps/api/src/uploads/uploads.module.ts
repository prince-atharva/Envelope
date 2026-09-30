import { Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { ClamdMalwareScanner } from './clamd-malware-scanner';
import { MalwareScanner, PassThroughMalwareScanner } from './malware-scanner';
import { PdfValidatorService } from './pdf-validator.service';

@Module({
  providers: [
    PdfValidatorService,
    PassThroughMalwareScanner,
    ClamdMalwareScanner,
    {
      // Chosen by MALWARE_SCANNER (docs/19, ADR 0026); `none` is the default.
      provide: MalwareScanner,
      inject: [AppConfig, PassThroughMalwareScanner, ClamdMalwareScanner],
      useFactory: (
        config: AppConfig,
        none: PassThroughMalwareScanner,
        clamav: ClamdMalwareScanner,
      ): MalwareScanner => (config.MALWARE_SCANNER === 'clamav' ? clamav : none),
    },
  ],
  exports: [PdfValidatorService],
})
export class UploadsModule {}
