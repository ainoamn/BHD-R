import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './auth/auth.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { PortfolioModule } from './portfolio/portfolio.module.js';
import { LeasingModule } from './leasing/leasing.module.js';
import { FinanceModule } from './finance/finance.module.js';
import { MaintenanceModule } from './maintenance/maintenance.module.js';
import { MediaModule } from './media/media.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { PlatformModule } from './platform/platform.module.js';
import { HealthModule } from './health/health.module.js';
import { PortalsModule } from './portals/portals.module.js';
import { OperationsModule } from './operations/operations.module.js';
import { AccountingModule } from './accounting/accounting.module.js';
import { AuthenticationGuard } from './common/auth.guard.js';
import { CsrfGuard } from './common/csrf.guard.js';
import { PermissionGuard } from './common/permission.guard.js';
import { AuditInterceptor } from './common/audit.interceptor.js';
import { IdempotencyInterceptor } from './common/idempotency.interceptor.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    DatabaseModule,
    AuthModule,
    OrganizationsModule,
    PortfolioModule,
    LeasingModule,
    FinanceModule,
    MaintenanceModule,
    MediaModule,
    ReportsModule,
    PlatformModule,
    PortalsModule,
    OperationsModule,
    AccountingModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
