import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { readStaysFlagsFromEnv, resolveStaysEnabledFromEnv } from '@bhd-r/config';
import {
  stayOpsBookingsQuerySchema,
  stayPerformanceQuerySchema,
  type StayOpsBookingsQuery,
  type StayPerformanceQuery,
} from '@bhd-r/contracts';
import type { ApiRequest } from '../common/api-http.js';
import { RequirePermissions } from '../common/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { StaysInventoryService } from './stays-inventory.service.js';
import { StaysBookingService } from './stays-booking.service.js';
import { StaysReportsService } from './stays-reports.service.js';

/** Fail-closed: platform kill-switch off → 404 (hide surface). */
function assertStaysPlatformEnabled(): void {
  const { platformEnabled } = readStaysFlagsFromEnv();
  if (!platformEnabled) {
    throw new NotFoundException();
  }
}

/**
 * Operations surface: platform off → 404; org not allow-listed → 403.
 * Property/unit layers are treated as enabled here so org allow-list is the Phase-2 gate;
 * profile-level flags will tighten this in later phases.
 */
function assertStaysOperationsEnabled(organizationId: string | null | undefined): void {
  assertStaysPlatformEnabled();
  const resolution = resolveStaysEnabledFromEnv({
    organizationId: organizationId ?? null,
    propertyEnabled: true,
    unitEnabled: true,
  });
  if (!resolution.organization) {
    throw new ForbiddenException('Stays is not enabled for this organization');
  }
}

@Controller('v1/stays')
export class StaysOperationsController {
  constructor(
    private readonly inventory: StaysInventoryService,
    private readonly bookings: StaysBookingService,
    private readonly reports: StaysReportsService,
  ) {}

  @RequirePermissions('stay.booking.read')
  @Get('reports/performance')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  performance(
    @Req() request: ApiRequest,
    @Query(new ZodPipe(stayPerformanceQuerySchema)) query: StayPerformanceQuery,
  ) {
    assertStaysOperationsEnabled(request.auth?.organizationId);
    return this.reports.performance(request.auth!, query);
  }

  @RequirePermissions('stay.booking.read')
  @Get('bookings')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  listBookings(
    @Req() request: ApiRequest,
    @Query(new ZodPipe(stayOpsBookingsQuerySchema)) query: StayOpsBookingsQuery,
  ) {
    assertStaysOperationsEnabled(request.auth?.organizationId);
    return this.bookings.listForOrganization(request.auth!, query);
  }

  @RequirePermissions('stay.booking.read')
  @Get('bookings/:id')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  getBooking(@Req() request: ApiRequest, @Param('id', ParseUUIDPipe) id: string) {
    assertStaysOperationsEnabled(request.auth?.organizationId);
    return this.bookings.getForOrganization(request.auth!, id);
  }

  @RequirePermissions('stay.inventory.manage')
  @Get('inventory/health')
  inventoryHealth(@Req() request: ApiRequest) {
    assertStaysOperationsEnabled(request.auth?.organizationId);
    return this.inventory.health();
  }

  @RequirePermissions('stay.inventory.manage')
  @Post('inventory/holds/release-expired')
  releaseExpired(@Req() request: ApiRequest) {
    assertStaysOperationsEnabled(request.auth?.organizationId);
    return this.inventory.releaseExpiredHolds(request.auth!.organizationId!);
  }

  @RequirePermissions('stay.booking.manage')
  @Post('bookings/:id/checkout')
  checkOut(@Req() request: ApiRequest, @Param('id', ParseUUIDPipe) id: string) {
    assertStaysOperationsEnabled(request.auth?.organizationId);
    return this.bookings.checkOut(request.auth!, id);
  }

  /**
   * Stay booking payments are confirmed via finance webhook kind `stay_booking`
   * (signed POST /v1/webhooks/payments/:provider) — not this ops route.
   */
  @RequirePermissions('stay.booking.manage')
  @Get('payments/webhook-status')
  webhookStatus(@Req() request: ApiRequest) {
    assertStaysOperationsEnabled(request.auth?.organizationId);
    return {
      kind: 'stay_booking',
      endpoint: 'POST /v1/webhooks/payments/:provider',
      note: 'Requires paymentIntentId, amount/currency match, and unique x-event-id',
    };
  }
}
