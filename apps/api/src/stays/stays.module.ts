import { Module } from '@nestjs/common';
import { PublicStaysController } from './public-stays.controller.js';
import { StaysOperationsController } from './stays-operations.controller.js';
import { StaysInventoryService } from './stays-inventory.service.js';
import { StaysBookingService } from './stays-booking.service.js';

@Module({
  controllers: [PublicStaysController, StaysOperationsController],
  providers: [StaysInventoryService, StaysBookingService],
  exports: [StaysInventoryService, StaysBookingService],
})
export class StaysModule {}
