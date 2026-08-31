import { Module, forwardRef } from '@nestjs/common';
import {
  FinanceController,
  InternalBillingController,
  PublicInvoiceController,
  PublicPaymentSessionController,
  PaymentWebhookController,
} from './finance.controller.js';
import { FinanceService } from './finance.service.js';
import { StaysModule } from '../stays/stays.module.js';

@Module({
  imports: [forwardRef(() => StaysModule)],
  controllers: [
    FinanceController,
    PublicInvoiceController,
    PublicPaymentSessionController,
    InternalBillingController,
    PaymentWebhookController,
  ],
  providers: [FinanceService],
  exports: [FinanceService],
})
export class FinanceModule {}
