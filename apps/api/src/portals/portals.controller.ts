import { Controller, Get, Param, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { RequirePermissions } from '../common/decorators.js';
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
    @Req() request: FastifyRequest,
  ) {
    return this.service.organizationOverview(request.auth!);
  }
  @RequirePermissions('property.read') @Get('properties') properties(
    @Req() request: FastifyRequest,
  ) {
    return this.service.listProperties(request.auth!);
  }
  @RequirePermissions('lease.read') @Get('leases') leases(@Req() request: FastifyRequest) {
    return this.service.listLeases(request.auth!);
  }
  @RequirePermissions('invoice.read') @Get('invoices') invoices(@Req() request: FastifyRequest) {
    return this.service.listInvoices(request.auth!);
  }
  @RequirePermissions('maintenance.read') @Get('maintenance') maintenance(
    @Req() request: FastifyRequest,
  ) {
    return this.service.listMaintenance(request.auth!);
  }
}

@Controller('v1/developer')
export class DeveloperPortalController {
  constructor(private readonly service: PortalsService) {}
  @RequirePermissions('developer.project.read') @Get('overview') overview(
    @Req() request: FastifyRequest,
  ) {
    return this.service.organizationOverview(request.auth!);
  }
  @RequirePermissions('developer.project.read') @Get('projects') projects(
    @Req() request: FastifyRequest,
  ) {
    return this.service.listProperties(request.auth!);
  }
}

@Controller('v1/tenant')
export class TenantPortalController {
  constructor(private readonly service: PortalsService) {}
  @RequirePermissions('tenant.profile.read') @Get('overview') overview(
    @Req() request: FastifyRequest,
  ) {
    return this.service.tenantOverview(request.auth!);
  }
  @RequirePermissions('contract.read') @Get('contracts') contracts(@Req() request: FastifyRequest) {
    return this.service.listTenantContracts(request.auth!);
  }
  @RequirePermissions('contract.read') @Get('contracts/:id') contract(
    @Req() request: FastifyRequest,
    @Param('id') id: string,
  ) {
    return this.service.tenantContract(request.auth!, id);
  }
  @RequirePermissions('lease.read') @Get('units') units(@Req() request: FastifyRequest) {
    return this.service.listTenantUnits(request.auth!);
  }
  @RequirePermissions('lease.read') @Get('leases') leases(@Req() request: FastifyRequest) {
    return this.service.listLeases(request.auth!);
  }
  @RequirePermissions('invoice.read') @Get('invoices') invoices(@Req() request: FastifyRequest) {
    return this.service.listInvoices(request.auth!);
  }
  @RequirePermissions('maintenance.read') @Get('maintenance') maintenance(
    @Req() request: FastifyRequest,
  ) {
    return this.service.listMaintenance(request.auth!);
  }
}
