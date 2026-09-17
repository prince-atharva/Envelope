import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AppConfig } from '../config/app-config';
import { MailProducerModule } from '../mail/mail.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordService } from './password.service';
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
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [AuthService, SessionService],
})
export class AuthModule {}
