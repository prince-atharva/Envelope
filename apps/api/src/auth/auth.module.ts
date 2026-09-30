import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AppConfig } from '../config/app-config';
import { EmbedAuthModule } from '../embed/embed-auth.module';
import { MailProducerModule } from '../mail/mail.module';
import { ApiKeyGuard } from './api-key.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { MfaChallengeService } from './mfa-challenge';
import { PasswordService } from './password.service';
import { RolesGuard } from './roles.guard';
import { SessionService } from './session.service';
import { TotpSecretCipher } from './totp-secret.cipher';
import { TwoFactorController } from './two-factor.controller';
import { TwoFactorService } from './two-factor.service';
import { TwoFactorPolicyController } from './two-factor-policy.controller';

const TOKEN_ISSUER = 'digitalsign-api';
const TOKEN_AUDIENCE = 'digitalsign';

@Module({
  imports: [
    MailProducerModule,
    EmbedAuthModule,
    JwtModule.registerAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        secret: config.JWT_ACCESS_SECRET,
        signOptions: {
          algorithm: 'HS256',
          expiresIn: config.JWT_ACCESS_TTL_SECONDS,
          issuer: TOKEN_ISSUER,
          audience: TOKEN_AUDIENCE,
        },
        verifyOptions: {
          algorithms: ['HS256'],
          issuer: TOKEN_ISSUER,
          audience: TOKEN_AUDIENCE,
        },
      }),
    }),
  ],
  controllers: [AuthController, TwoFactorController, TwoFactorPolicyController],
  providers: [
    AuthService,
    PasswordService,
    SessionService,
    TotpSecretCipher,
    TwoFactorService,
    MfaChallengeService,
    ApiKeyGuard,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // After JwtAuthGuard: it reads req.user, which only JwtAuthGuard sets.
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  // PasswordService is exported too: UsersModule needs it to lock an
  // invited account's password until the invitation is accepted (docs/17
  // step 6), and ApiKeysModule needs it for the same reason on a tenant's
  // service-account user (ADR 0015).
  exports: [AuthService, SessionService, PasswordService, TwoFactorService],
})
export class AuthModule {}
