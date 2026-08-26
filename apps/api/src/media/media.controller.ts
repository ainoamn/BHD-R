import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { ApiRequest } from '../common/api-http.js';
import { z } from 'zod';
import { Idempotent, Public, RequirePermissions } from '../common/decorators.js';
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
  position: z.number().int().min(0).max(500).optional(),
});
const reservationIntentSchema = intentSchema
  .omit({ purpose: true, unitId: true })
  .extend({ reservationId: z.uuid() });
const reservationCompleteSchema = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  reservationId: z.uuid(),
});

@Controller('v1/media')
export class MediaController {
  constructor(private readonly service: MediaService) {}
  @RequirePermissions('media.create') @Post('upload-intents') create(
    @Req() request: ApiRequest,
    @Body(new ZodPipe(intentSchema)) body: z.infer<typeof intentSchema>,
  ) {
    return this.service.createUploadIntent(request.auth!, body);
  }

  /** Browser → Nest binary upload (token). Avoids direct S3 CORS / Failed to fetch. */
  @Public()
  @Put('ingress/:token')
  ingress(@Param('token') token: string, @Req() request: ApiRequest) {
    const body = request.body;
    if (!Buffer.isBuffer(body))
      throw new UnsupportedMediaTypeException('Expected raw upload body');
    const contentType =
      typeof request.headers['content-type'] === 'string'
        ? request.headers['content-type']
        : undefined;
    return this.service.acceptIngressUpload(token, body, contentType);
  }

  @RequirePermissions('media.create') @Idempotent() @Post(':id/complete') complete(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Body(new ZodPipe(completeSchema)) body: z.infer<typeof completeSchema>,
  ) {
    return this.service.complete(request.auth!, id, body);
  }

  @RequirePermissions('reservation.document.submit')
  @Post('reservation-upload-intents')
  reservationIntent(
    @Req() request: ApiRequest,
    @Body(new ZodPipe(reservationIntentSchema)) body: z.infer<typeof reservationIntentSchema>,
  ) {
    return this.service.createUploadIntent(request.auth!, {
      ...body,
      purpose: 'reservation_document',
    });
  }

  @RequirePermissions('reservation.document.submit')
  @Idempotent()
  @Post(':id/complete-reservation')
  completeReservation(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Body(new ZodPipe(reservationCompleteSchema))
    body: z.infer<typeof reservationCompleteSchema>,
  ) {
    return this.service.complete(request.auth!, id, body);
  }

  @RequirePermissions('reservation.read')
  @Get(':id/reservation-document')
  reservationDocument(@Req() request: ApiRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.reservationDocumentUrl(request.auth!, id);
  }
}
