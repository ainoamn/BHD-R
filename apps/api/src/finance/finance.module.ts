import { Module } from '@nestjs/common';
import {
  FinanceController,
  PublicInvoiceController,
  PaymentWebhookController,
} from './finance.controller.js';
import { FinanceService } from './finance.service.js';

@Module({
  controllers: [FinanceController, PublicInvoiceController, PaymentWebhookController],
  providers: [FinanceService],
})
export class FinanceModule {}
