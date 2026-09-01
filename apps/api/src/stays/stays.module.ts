import { Module } from '@nestjs/common';
import { GuestStaysController } from './guest-stays.controller.js';
import { PublicStaysController } from './public-stays.controller.js';
import { StaysOperationsController } from './stays-operations.controller.js';
import { StaysInventoryService } from './stays-inventory.service.js';
import { StaysBookingService } from './stays-booking.service.js';
import { StaysReportsService } from './stays-reports.service.js';
import { StaysSearchService } from './stays-search.service.js';
import { StaysSetupService } from './stays-setup.service.js';

@Module({
  controllers: [PublicStaysController, GuestStaysController, StaysOperationsController],
  providers: [
    StaysInventoryService,
    StaysBookingService,
    StaysReportsService,
    StaysSearchService,
    StaysSetupService,
  ],
  exports: [
    StaysInventoryService,
    StaysBookingService,
    StaysReportsService,
    StaysSearchService,
    StaysSetupService,
  ],
})
export class StaysModule {}
