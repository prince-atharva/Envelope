import { Module } from '@nestjs/common';
import { MalwareScanner, PassThroughMalwareScanner } from './malware-scanner';
import { PdfValidatorService } from './pdf-validator.service';

@Module({
  providers: [
    PdfValidatorService,
    { provide: MalwareScanner, useClass: PassThroughMalwareScanner },
  ],
  exports: [PdfValidatorService],
})
export class UploadsModule {}
