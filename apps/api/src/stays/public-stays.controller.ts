import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { readStaysFlagsFromEnv } from '@bhd-r/config';
import {
  createStayBookingSchema,
  createStayHoldSchema,
  createStayQuoteSchema,
  stayAvailabilityQuerySchema,
  stayInventoryCalendarQuerySchema,
  stayGuestBookingLookupSchema,
  staySearchQuerySchema,
  type CreateStayBookingInput,
  type CreateStayHoldInput,
  type CreateStayQuoteInput,
  type StayAvailabilityQuery,
  type StayInventoryCalendarQuery,
  type StayGuestBookingLookup,
  type StaySearchQuery,
} from '@bhd-r/contracts';
import { Public } from '../common/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { StaysBookingService } from './stays-booking.service.js';
import { StaysSearchService } from './stays-search.service.js';

/** Fail-closed: platform kill-switch off → 404 (hide surface). */
export function assertStaysPlatformEnabled(): void {
  const { platformEnabled } = readStaysFlagsFromEnv();
  if (!platformEnabled) {
    throw new NotFoundException();
  }
}

function requireIdempotencyKey(value: string | undefined): string {
  if (typeof value !== 'string' || value.length < 8 || value.length > 200) {
    throw new BadRequestException('A valid idempotency-key header is required');
  }
  return value;
}

@Public()
@Controller('v1/public/stays')
export class PublicStaysController {
  constructor(
    private readonly searchService: StaysSearchService,
    private readonly bookingService: StaysBookingService,
  ) {}

  @Get('search')
  search(@Query(new ZodPipe(staySearchQuerySchema)) query: StaySearchQuery) {
    assertStaysPlatformEnabled();
    return this.searchService.search(query);
  }

  @Get('bookings/lookup')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  lookupBooking(@Query(new ZodPipe(stayGuestBookingLookupSchema)) query: StayGuestBookingLookup) {
    assertStaysPlatformEnabled();
    return this.bookingService.getPublicByReference(query.referenceCode);
  }

  @Post('holds')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  createHold(
    @Headers('idempotency-key') idempotencyKey: string,
    @Body(new ZodPipe(createStayHoldSchema)) body: CreateStayHoldInput,
  ) {
    assertStaysPlatformEnabled();
    return this.bookingService.createHold(body, requireIdempotencyKey(idempotencyKey));
  }

  @Post('bookings')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  createBooking(
    @Headers('idempotency-key') idempotencyKey: string,
    @Body(new ZodPipe(createStayBookingSchema)) body: CreateStayBookingInput,
  ) {
    assertStaysPlatformEnabled();
    return this.bookingService.createBookingFromHold(
      body,
      requireIdempotencyKey(idempotencyKey),
    );
  }

  @Get(':slug/calendar')
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  calendar(
    @Param('slug') slug: string,
    @Query(new ZodPipe(stayInventoryCalendarQuerySchema)) query: StayInventoryCalendarQuery,
  ) {
    assertStaysPlatformEnabled();
    return this.bookingService.getInventoryCalendar(slug, query);
  }

  @Get(':slug/availability')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  availability(
    @Param('slug') slug: string,
    @Query(new ZodPipe(stayAvailabilityQuerySchema)) query: StayAvailabilityQuery,
  ) {
    assertStaysPlatformEnabled();
    return this.bookingService.getAvailability(slug, query);
  }

  @Post(':slug/quotes')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  createQuote(
    @Param('slug') slug: string,
    @Body(new ZodPipe(createStayQuoteSchema)) body: CreateStayQuoteInput,
  ) {
    assertStaysPlatformEnabled();
    return this.bookingService.createQuote(slug, body);
  }

  @Get(':slug')
  async detail(@Param('slug') slug: string, @Query('unitId') unitId?: string) {
    assertStaysPlatformEnabled();
    const detail = await this.searchService.getBySlug(slug, unitId?.trim() || null);
    if (!detail) throw new NotFoundException();
    return detail;
  }
}
