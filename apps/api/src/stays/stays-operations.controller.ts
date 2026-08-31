import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { readStaysFlagsFromEnv, resolveStaysEnabledFromEnv } from '@bhd-r/config';
import type { ApiRequest } from '../common/api-http.js';
import { RequirePermissions } from '../common/decorators.js';
import { StaysInventoryService } from './stays-inventory.service.js';

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
  constructor(private readonly inventory: StaysInventoryService) {}

  @RequirePermissions('stay.booking.read')
  @Get('bookings')
  listBookings(@Req() request: ApiRequest) {
    assertStaysOperationsEnabled(request.auth?.organizationId);
    return { items: [] };
  }

  @RequirePermissions('stay.booking.read')
  @Get('bookings/:id')
  getBooking(@Req() request: ApiRequest, @Param('id', ParseUUIDPipe) id: string) {
    assertStaysOperationsEnabled(request.auth?.organizationId);
    return { id, status: null };
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

  /**
   * Payment webhook for stay_booking intents is intentionally not implemented here.
   * Phase 5+: extend finance webhook with signed stay_booking events, amount/currency match,
   * and single-transaction confirm — stub comment only.
   */
  @RequirePermissions('stay.booking.manage')
  @Get('payments/webhook-status')
  webhookStatus(@Req() request: ApiRequest) {
    assertStaysOperationsEnabled(request.auth?.organizationId);
    return {
      note: 'stay_booking payment webhooks: not implemented in Phase 2 (stub)',
    };
  }
}
