import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { readStaysFlagsFromEnv } from '@bhd-r/config';
import { staySearchQuerySchema } from '@bhd-r/contracts';
import { Public } from '../common/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';

/** Fail-closed: platform kill-switch off → 404 (hide surface). */
export function assertStaysPlatformEnabled(): void {
  const { platformEnabled } = readStaysFlagsFromEnv();
  if (!platformEnabled) {
    throw new NotFoundException();
  }
}

@Public()
@Controller('v1/public/stays')
export class PublicStaysController {
  @Get('search')
  search(@Query(new ZodPipe(staySearchQuerySchema)) _query: unknown) {
    assertStaysPlatformEnabled();
    // Phase 2 skeleton — search projection lands with inventory projector.
    return { items: [], nextCursor: null };
  }

  @Get(':slug')
  detail(@Param('slug') _slug: string) {
    assertStaysPlatformEnabled();
    throw new NotFoundException();
  }
}
