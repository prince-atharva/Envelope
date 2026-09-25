import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MailProducerModule } from '../mail/mail.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule, MailProducerModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
