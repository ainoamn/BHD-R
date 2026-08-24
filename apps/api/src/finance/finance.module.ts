import { Module } from '@nestjs/common';
import {
  FinanceController,
  InternalBillingController,
  PublicInvoiceController,
  PublicPaymentSessionController,
  PaymentWebhookController,
} from './finance.controller.js';
import { FinanceService } from './finance.service.js';

@Module({
  controllers: [
    FinanceController,
    PublicInvoiceController,
    PublicPaymentSessionController,
    InternalBillingController,
    PaymentWebhookController,
  ],
  providers: [FinanceService],
})
export class FinanceModule {}
