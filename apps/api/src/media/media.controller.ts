import { Body, Controller, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Idempotent, RequirePermissions } from '../common/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { MediaService } from './media.service.js';

const intentSchema = z.object({
  purpose: z.enum(['property_image', 'attachment']),
  unitId: z.uuid().optional(),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  byteSize: z
    .number()
    .int()
    .positive()
    .max(25 * 1024 * 1024),
});
const completeSchema = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  unitId: z.uuid().optional(),
});

@Controller('v1/media')
export class MediaController {
  constructor(private readonly service: MediaService) {}
  @RequirePermissions('media.create') @Post('upload-intents') create(
    @Req() request: FastifyRequest,
    @Body(new ZodPipe(intentSchema)) body: z.infer<typeof intentSchema>,
  ) {
    return this.service.createUploadIntent(request.auth!, body);
  }
  @RequirePermissions('media.create') @Idempotent() @Post(':id/complete') complete(
    @Req() request: FastifyRequest,
    @Param('id') id: string,
    @Body(new ZodPipe(completeSchema)) body: z.infer<typeof completeSchema>,
  ) {
    return this.service.complete(request.auth!, id, body);
  }
}
