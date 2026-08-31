import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { readStaysFlagsFromEnv } from '@bhd-r/config';
import { staySearchQuerySchema, type StaySearchQuery } from '@bhd-r/contracts';
import { Public } from '../common/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { StaysSearchService } from './stays-search.service.js';

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
  constructor(private readonly searchService: StaysSearchService) {}

  @Get('search')
  search(@Query(new ZodPipe(staySearchQuerySchema)) query: StaySearchQuery) {
    assertStaysPlatformEnabled();
    return this.searchService.search(query);
  }

  @Get(':slug')
  async detail(@Param('slug') slug: string) {
    assertStaysPlatformEnabled();
    const detail = await this.searchService.getBySlug(slug);
    if (!detail) throw new NotFoundException();
    return detail;
  }
}
