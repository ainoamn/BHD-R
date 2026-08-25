import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { FinanceModule } from '../finance/finance.module.js';
import { LeasingController } from './leasing.controller.js';
import { LeasingService } from './leasing.service.js';

@Module({
  imports: [AuthModule, FinanceModule],
  controllers: [LeasingController],
  providers: [LeasingService],
  exports: [LeasingService],
})
export class LeasingModule {}
