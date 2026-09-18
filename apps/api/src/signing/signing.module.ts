import { Module } from '@nestjs/common';
import { TokenGuardianService } from './token-guardian.service';

/** The public signing surface: everything a signer reaches through their link. */
@Module({
  providers: [TokenGuardianService],
  exports: [TokenGuardianService],
})
export class SigningModule {}
