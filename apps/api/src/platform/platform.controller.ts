import { Controller, Get } from '@nestjs/common';
import { Public, RequirePermissions } from '../common/decorators.js';
import { PlatformService } from './platform.service.js';

@Controller('v1/platform')
export class PlatformController {
  constructor(private readonly service: PlatformService) {}
  @RequirePermissions('platform.settings.read') @Get('organizations') organizations() {
    return this.service.listOrganizations();
  }
  @RequirePermissions('platform.audit.read') @Get('audit') audit() {
    return this.service.listAudit();
  }
  @Public() @Get('country-packs') countryPacks() {
    return this.service.listCountryPacks();
  }
  @Public() @Get('currencies') currencies() {
    return this.service.listCurrencies();
  }
}
