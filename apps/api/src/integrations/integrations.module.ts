import { Module } from '@nestjs/common';
import { HisabyController } from './hisaby.controller.js';
import { HisabyService } from './hisaby.service.js';

@Module({
  controllers: [HisabyController],
  providers: [HisabyService],
  exports: [HisabyService],
})
export class IntegrationsModule {}
