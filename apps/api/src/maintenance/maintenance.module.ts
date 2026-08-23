import { Module } from '@nestjs/common';
import { MaintenanceController } from './maintenance.controller.js';
import { MaintenanceService } from './maintenance.service.js';

@Module({ controllers: [MaintenanceController], providers: [MaintenanceService] })
export class MaintenanceModule {}
