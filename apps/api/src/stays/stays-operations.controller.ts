import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { readStaysFlagsFromEnv, resolveStaysEnabledFromEnv } from '@bhd-r/config';
import {
  stayOpsBookingsQuerySchema,
  stayPerformanceQuerySchema,
  staySetupContextQuerySchema,
  createStayUnitTypeSchema,
  createStayProfilesSchema,
  updateStayProfileSchema,
  upsertStayRatePlanSchema,
  upsertStayPublicListingSchema,
  type StayOpsBookingsQuery,
  type StayPerformanceQuery,
  type StaySetupContextQuery,
  type CreateStayUnitTypeInput,
  type CreateStayProfilesInput,
  type UpdateStayProfileInput,
  type UpsertStayRatePlanInput,
  type UpsertStayPublicListingInput,
} from '@bhd-r/contracts';
import type { ApiRequest, ApiResponse } from '../common/api-http.js';
import { RequirePermissions } from '../common/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { StaysInventoryService } from './stays-inventory.service.js';
import { StaysBookingService } from './stays-booking.service.js';
import { StaysReportsService } from './stays-reports.service.js';
import { StaysSetupService } from './stays-setup.service.js';

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
    private readonly setup: StaysSetupService,
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
  @Get('setup/context')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  setupContext(
    @Req() request: ApiRequest,
    @Query(new ZodPipe(staySetupContextQuerySchema)) query: StaySetupContextQuery,
  ) {
    assertStaysOperationsEnabled(request.auth?.organizationId);
    return this.setup.getContext(request.auth!, query.propertyId);
  }

  @RequirePermissions('stay.inventory.manage')
  @Post('setup/unit-types')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  createUnitType(
    @Req() request: ApiRequest,
    @Body(new ZodPipe(createStayUnitTypeSchema)) body: CreateStayUnitTypeInput,
  ) {
    assertStaysOperationsEnabled(request.auth?.organizationId);
    return this.setup.createUnitType(request.auth!, body);
  }

  @RequirePermissions('stay.inventory.manage')
  @Post('setup/profiles')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  createProfiles(
    @Req() request: ApiRequest,
    @Body(new ZodPipe(createStayProfilesSchema)) body: CreateStayProfilesInput,
  ) {
    assertStaysOperationsEnabled(request.auth?.organizationId);
    return this.setup.createProfiles(request.auth!, body);
  }

  @RequirePermissions('stay.inventory.manage')
  @Patch('setup/profiles/:id')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  updateProfile(
    @Req() request: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateStayProfileSchema)) body: UpdateStayProfileInput,
  ) {
    assertStaysOperationsEnabled(request.auth?.organizationId);
    return this.setup.updateProfile(request.auth!, id, body);
  }

  @RequirePermissions('stay.rate.manage')
  @Post('setup/profiles/:id/rate-plan')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  upsertRatePlan(
    @Req() request: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(upsertStayRatePlanSchema)) body: UpsertStayRatePlanInput,
  ) {
    assertStaysOperationsEnabled(request.auth?.organizationId);
    return this.setup.upsertRatePlan(request.auth!, id, body);
  }

  @RequirePermissions('stay.inventory.manage')
  @Post('setup/listings')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  upsertListing(
    @Req() request: ApiRequest,
    @Body(new ZodPipe(upsertStayPublicListingSchema)) body: UpsertStayPublicListingInput,
  ) {
    assertStaysOperationsEnabled(request.auth?.organizationId);
    return this.setup.upsertListing(request.auth!, body);
  }

  @RequirePermissions('stay.inventory.manage')
  @Post('setup/profiles/:id/publish')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  publishProfile(@Req() request: ApiRequest, @Param('id', ParseUUIDPipe) id: string) {
    assertStaysOperationsEnabled(request.auth?.organizationId);
    return this.setup.publishProfile(request.auth!, id);
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

  @RequirePermissions('stay.booking.manage')
  @Post('bookings/:id/cancel')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  cancel(@Req() request: ApiRequest, @Param('id', ParseUUIDPipe) id: string) {
    assertStaysOperationsEnabled(request.auth?.organizationId);
    return this.bookings.cancel(request.auth!, id);
  }

  @RequirePermissions('stay.booking.manage')
  @Post('bookings/:id/no-show')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  markNoShow(@Req() request: ApiRequest, @Param('id', ParseUUIDPipe) id: string) {
    assertStaysOperationsEnabled(request.auth?.organizationId);
    return this.bookings.markNoShow(request.auth!, id);
  }

  @RequirePermissions('stay.booking.read')
  @Get('calendar-units')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  listCalendarUnits(@Req() request: ApiRequest) {
    assertStaysOperationsEnabled(request.auth?.organizationId);
    return this.inventory.listCalendarUnits(request.auth!);
  }

  @RequirePermissions('stay.booking.read')
  @Get('units/:unitId/calendar.ics')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async exportUnitCalendar(
    @Req() request: ApiRequest,
    @Param('unitId', ParseUUIDPipe) unitId: string,
    @Res({ passthrough: false }) reply: ApiResponse,
  ) {
    assertStaysOperationsEnabled(request.auth?.organizationId);
    const ics = await this.inventory.exportUnitCalendarIcs(request.auth!, unitId);
    reply
      .status(200)
      .setHeader('Content-Type', 'text/calendar; charset=utf-8')
      .setHeader(
        'Content-Disposition',
        `attachment; filename="bhd-r-stay-${unitId.slice(0, 8)}.ics"`,
      )
      .send(ics);
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
