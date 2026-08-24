import { Module } from '@nestjs/common';
import {
  DeveloperPortalController,
  OwnerPortalController,
  PlatformPortalController,
  TenantPortalController,
} from './portals.controller.js';
import { PortalsService } from './portals.service.js';
import { LeasingModule } from '../leasing/leasing.module.js';

@Module({
  imports: [LeasingModule],
  controllers: [
    PlatformPortalController,
    OwnerPortalController,
    DeveloperPortalController,
    TenantPortalController,
  ],
  providers: [PortalsService],
})
export class PortalsModule {}
