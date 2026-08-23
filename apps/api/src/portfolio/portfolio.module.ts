import { Module } from '@nestjs/common';
import {
  PortfolioController,
  PublicListingsController,
  PublicPropertiesController,
  PublicUnitsController,
} from './portfolio.controller.js';
import { PortfolioService } from './portfolio.service.js';

@Module({
  controllers: [
    PortfolioController,
    PublicListingsController,
    PublicUnitsController,
    PublicPropertiesController,
  ],
  providers: [PortfolioService],
})
export class PortfolioModule {}
