import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { ApiRequest } from '../common/api-http.js';
import { z } from 'zod';
import { RequirePermissions } from '../common/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PortalsService } from './portals.service.js';

@Controller('v1/platform')
export class PlatformPortalController {
  constructor(private readonly service: PortalsService) {}
  @RequirePermissions('platform.settings.read') @Get('overview') overview() {
    return this.service.platformOverview();
  }
}

@Controller('v1/owner')
export class OwnerPortalController {
  constructor(private readonly service: PortalsService) {}
  @RequirePermissions('organization.read') @Get('overview') overview(
    @Req() request: ApiRequest,
  ) {
    return this.service.organizationOverview(request.auth!);
  }
  @RequirePermissions('property.read') @Get('properties') properties(
    @Req() request: ApiRequest,
    @Query('view') view?: string,
  ) {
    return this.service.listProperties(request.auth!, {
      archivedOnly: view === 'archive' || view === 'archived',
    });
  }
  @RequirePermissions('lease.read') @Get('leases') leases(@Req() request: ApiRequest) {
    return this.service.listLeases(request.auth!);
  }
  @RequirePermissions('invoice.read') @Get('invoices') invoices(@Req() request: ApiRequest) {
    return this.service.listInvoices(request.auth!);
  }
  @RequirePermissions('maintenance.read') @Get('maintenance') maintenance(
    @Req() request: ApiRequest,
  ) {
    return this.service.listMaintenance(request.auth!);
  }
}

@Controller('v1/developer')
export class DeveloperPortalController {
  constructor(private readonly service: PortalsService) {}
  @RequirePermissions('developer.project.read') @Get('overview') overview(
    @Req() request: ApiRequest,
  ) {
    return this.service.organizationOverview(request.auth!);
  }
  @RequirePermissions('developer.project.read') @Get('projects') projects(
    @Req() request: ApiRequest,
    @Query('view') view?: string,
  ) {
    return this.service.listProperties(request.auth!, {
      archivedOnly: view === 'archive' || view === 'archived',
    });
  }
}

@Controller('v1/tenant')
export class TenantPortalController {
  constructor(private readonly service: PortalsService) {}
  @RequirePermissions('tenant.profile.read') @Get('overview') overview(
    @Req() request: ApiRequest,
  ) {
    return this.service.tenantOverview(request.auth!);
  }
  @RequirePermissions('contract.read') @Get('contracts') contracts(@Req() request: ApiRequest) {
    return this.service.listTenantContracts(request.auth!);
  }
  @RequirePermissions('contract.read') @Get('contracts/:id') contract(
    @Req() request: ApiRequest,
    @Param('id') id: string,
  ) {
    return this.service.tenantContract(request.auth!, id);
  }
  @RequirePermissions('lease.read') @Get('units') units(@Req() request: ApiRequest) {
    return this.service.listTenantUnits(request.auth!);
  }
  @RequirePermissions('lease.read') @Get('leases') leases(@Req() request: ApiRequest) {
    return this.service.listLeases(request.auth!);
  }
  @RequirePermissions('lease.cancel.request')
  @Post('leases/:id/cancellation-requests')
  requestCancellation(
    @Req() request: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(
      new ZodPipe(
        z
          .object({
            proposedEndsOn: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .optional(),
            note: z.string().max(5000).optional(),
          })
          .strict(),
      ),
    )
    body: { proposedEndsOn?: string; note?: string },
  ) {
    return this.service.requestLeaseCancellation(request.auth!, id, body);
  }
  @RequirePermissions('invoice.read') @Get('invoices') invoices(@Req() request: ApiRequest) {
    return this.service.listInvoices(request.auth!);
  }
  @RequirePermissions('maintenance.read') @Get('maintenance') maintenance(
    @Req() request: ApiRequest,
  ) {
    return this.service.listMaintenance(request.auth!);
  }
}
