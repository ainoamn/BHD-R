import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { ApiRequest } from '../common/api-http.js';
import { z } from 'zod';
import { Public, RequirePermissions } from '../common/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PlatformService } from './platform.service.js';

const encryptionBackfillSchema = z.object({
  target: z.enum([
    'users.totp_secret_encrypted',
    'parties.national_id_encrypted',
    'parties.registration_number_encrypted',
    'party_identity_documents.number_encrypted',
    'payment_gateway_settings.credentials_encrypted',
  ]),
  batchSize: z.number().int().min(1).max(200).optional(),
});

@Controller('v1/platform')
export class PlatformController {
  constructor(private readonly service: PlatformService) {}
  @RequirePermissions('platform.settings.read') @Get('organizations') organizations() {
    return this.service.listOrganizations();
  }
  @RequirePermissions('platform.audit.read') @Get('audit') audit() {
    return this.service.listAudit();
  }
  @RequirePermissions('platform.settings.read') @Get('users') users() {
    return this.service.listUsers();
  }
  @RequirePermissions('platform.settings.read') @Get('settings') settings() {
    return this.service.settingsHealth();
  }
  @RequirePermissions('platform.settings.write')
  @Post('encryption/backfill')
  encryptionBackfill(
    @Req() request: ApiRequest,
    @Body(new ZodPipe(encryptionBackfillSchema)) body: z.infer<typeof encryptionBackfillSchema>,
  ) {
    return this.service.enqueueEncryptionBackfill(request.auth!, body);
  }
  @Public() @Get('country-packs') countryPacks() {
    return this.service.listCountryPacks();
  }
  @Public() @Get('currencies') currencies() {
    return this.service.listCurrencies();
  }
}
