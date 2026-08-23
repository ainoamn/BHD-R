import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import {
  AUTHENTICATED_ROUTE,
  PUBLIC_ROUTE,
  REQUIRED_PERMISSIONS,
} from '../src/common/decorators.js';
import { AuthController, MeController } from '../src/auth/auth.controller.js';
import { OrganizationsController } from '../src/organizations/organizations.controller.js';
import {
  PortfolioController,
  PublicListingsController,
  PublicPropertiesController,
  PublicUnitsController,
} from '../src/portfolio/portfolio.controller.js';
import { LeasingController } from '../src/leasing/leasing.controller.js';
import {
  FinanceController,
  PaymentWebhookController,
  PublicInvoiceController,
} from '../src/finance/finance.controller.js';
import { MaintenanceController } from '../src/maintenance/maintenance.controller.js';
import { MediaController } from '../src/media/media.controller.js';
import { ReportsController } from '../src/reports/reports.controller.js';
import { AccountingController } from '../src/accounting/accounting.controller.js';
import { OperationsController } from '../src/operations/operations.controller.js';
import { PlatformController } from '../src/platform/platform.controller.js';
import { HealthController } from '../src/health/health.controller.js';
import {
  DeveloperPortalController,
  OwnerPortalController,
  PlatformPortalController,
  TenantPortalController,
} from '../src/portals/portals.controller.js';

const controllers = [
  AuthController,
  MeController,
  OrganizationsController,
  PortfolioController,
  PublicListingsController,
  PublicUnitsController,
  PublicPropertiesController,
  LeasingController,
  FinanceController,
  PaymentWebhookController,
  PublicInvoiceController,
  MaintenanceController,
  MediaController,
  ReportsController,
  AccountingController,
  OperationsController,
  PlatformController,
  HealthController,
  DeveloperPortalController,
  OwnerPortalController,
  PlatformPortalController,
  TenantPortalController,
];

describe('central route authorization policy', () => {
  it('classifies every HTTP handler as public, authenticated, or permission protected', () => {
    const unclassified: string[] = [];
    for (const controller of controllers) {
      const prototype = controller.prototype as object;
      for (const propertyName of Object.getOwnPropertyNames(prototype)) {
        if (propertyName === 'constructor') continue;
        const handler = (prototype as Record<string, unknown>)[propertyName];
        if (typeof handler !== 'function' || !Reflect.hasMetadata('method', handler)) continue;
        const targets = [handler, controller];
        const classified =
          targets.some((target) => Reflect.getMetadata(PUBLIC_ROUTE, target) === true) ||
          targets.some((target) => Reflect.getMetadata(AUTHENTICATED_ROUTE, target) === true) ||
          targets.some((target) =>
            Array.isArray(Reflect.getMetadata(REQUIRED_PERMISSIONS, target)),
          );
        if (!classified) unclassified.push(`${controller.name}.${propertyName}`);
      }
    }
    expect(unclassified).toEqual([]);
  });
});
