import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { readStaysFlagsFromEnv } from '@bhd-r/config';
import {
  stayGuestBookingClaimSchema,
  type StayGuestBookingClaim,
} from '@bhd-r/contracts';
import type { ApiRequest } from '../common/api-http.js';
import { Authenticated } from '../common/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { StaysBookingService } from './stays-booking.service.js';

function assertStaysPlatformEnabled(): void {
  const { platformEnabled } = readStaysFlagsFromEnv();
  if (!platformEnabled) {
    throw new NotFoundException();
  }
}

@Authenticated()
@Controller('v1/guest/stays')
export class GuestStaysController {
  constructor(private readonly bookings: StaysBookingService) {}

  @Get('bookings')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  list(@Req() request: ApiRequest) {
    assertStaysPlatformEnabled();
    return this.bookings.listForUser(request.auth!.sub);
  }

  @Post('bookings/claim')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  claim(
    @Req() request: ApiRequest,
    @Body(new ZodPipe(stayGuestBookingClaimSchema)) body: StayGuestBookingClaim,
  ) {
    assertStaysPlatformEnabled();
    return this.bookings.claimForUser(request.auth!.sub, body.referenceCode);
  }

  @Get('bookings/:id')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  get(@Req() request: ApiRequest, @Param('id', ParseUUIDPipe) id: string) {
    assertStaysPlatformEnabled();
    return this.bookings.getForUser(request.auth!.sub, id);
  }
}
