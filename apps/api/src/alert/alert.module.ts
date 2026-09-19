import { type DynamicModule, Global, Module } from '@nestjs/common';
import { MailProducerModule, MailTransportModule } from '../mail/mail.module';
import { AlertDelivery, AlertService } from './alert.service';
import { DirectAlertDelivery, QueuedAlertDelivery } from './alert-delivery';

/** Alerts for both processes. `queued` in the API, `direct` in the worker. */
@Global()
@Module({})
export class AlertModule {
  static forRoot(delivery: 'queued' | 'direct'): DynamicModule {
    return {
      module: AlertModule,
      imports: [delivery === 'queued' ? MailProducerModule : MailTransportModule],
      providers: [
        AlertService,
        {
          provide: AlertDelivery,
          useClass: delivery === 'queued' ? QueuedAlertDelivery : DirectAlertDelivery,
        },
      ],
      exports: [AlertService],
    };
  }
}
