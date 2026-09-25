import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AppConfig } from '../config/app-config';
import { MailProducerModule } from '../mail/mail.module';
import { ApiKeyGuard } from './api-key.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordService } from './password.service';
import { RolesGuard } from './roles.guard';
import { SessionService } from './session.service';

const TOKEN_ISSUER = 'digitalsign-api';
const TOKEN_AUDIENCE = 'digitalsign';

@Module({
  imports: [
    MailProducerModule,
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
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    SessionService,
    ApiKeyGuard,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // After JwtAuthGuard: it reads req.user, which only JwtAuthGuard sets.
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  // PasswordService is exported too: UsersModule needs it to lock an
  // invited account's password until the invitation is accepted (docs/17
  // step 6), and ApiKeysModule needs it for the same reason on a tenant's
  // service-account user (ADR 0015).
  exports: [AuthService, SessionService, PasswordService],
})
export class AuthModule {}
