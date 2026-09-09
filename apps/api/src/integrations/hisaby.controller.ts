import { Body, Controller, Get, Post, Put, Req } from '@nestjs/common';
import type { ApiRequest } from '../common/api-http.js';
import { z } from 'zod';
import { Idempotent, RequirePermissions } from '../common/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { HisabyService } from './hisaby.service.js';

const connectionSchema = z
  .object({
    eventsUrl: z
      .string()
      .trim()
      .url()
      .max(500)
      .refine((value) => value.startsWith('https://'), 'Events URL must be HTTPS'),
    inboundToken: z.string().trim().min(16).max(500),
    hisabyCompanyId: z.string().trim().min(1).max(80).optional(),
    status: z.enum(['active', 'paused']).optional(),
  })
  .strict();

@Controller('v1/integrations/hisaby')
export class HisabyController {
  constructor(private readonly service: HisabyService) {}

  @RequirePermissions('organization.read')
  @Get('connection')
  getConnection(@Req() request: ApiRequest) {
    return this.service.getConnection(request.auth!);
  }

  @RequirePermissions('api_key.write')
  @Idempotent()
  @Put('connection')
  upsertConnection(
    @Req() request: ApiRequest,
    @Body(new ZodPipe(connectionSchema)) body: z.infer<typeof connectionSchema>,
  ) {
    return this.service.upsertConnection(request.auth!, body);
  }

  @RequirePermissions('api_key.write')
  @Post('connection/test')
  testConnection(@Req() request: ApiRequest) {
    return this.service.testConnection(request.auth!);
  }

  /**
   * Full read snapshot for Hisaby pull sync.
   * Returns only collections the API key/session is permitted to read.
   */
  @RequirePermissions('organization.read')
  @Get('export')
  exportSnapshot(@Req() request: ApiRequest) {
    return this.service.exportSnapshot(request.auth!);
  }
}
