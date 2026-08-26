import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { ApiRequest } from '../common/api-http.js';
import { z } from 'zod';
import { createMaintenanceTicketSchema } from '@bhd-r/contracts';
import { Idempotent, RequirePermissions } from '../common/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { MaintenanceService } from './maintenance.service.js';

const updateSchema = z.object({
  status: z.enum(['open', 'assigned', 'in_progress', 'resolved', 'closed', 'cancelled']),
  assignedToUserId: z.uuid().optional(),
  blocksAvailability: z.boolean().optional(),
});

@Controller('v1/maintenance')
export class MaintenanceController {
  constructor(private readonly service: MaintenanceService) {}
  @RequirePermissions('maintenance.read') @Get() list(@Req() request: ApiRequest) {
    return this.service.list(request.auth!);
  }
  @RequirePermissions('maintenance.create') @Idempotent() @Post() create(
    @Req() request: ApiRequest,
    @Body(new ZodPipe(createMaintenanceTicketSchema))
    body: z.infer<typeof createMaintenanceTicketSchema>,
  ) {
    return this.service.create(request.auth!, body);
  }
  @RequirePermissions('maintenance.update') @Patch(':id') update(
    @Req() request: ApiRequest,
    @Param('id') id: string,
    @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>,
  ) {
    return this.service.update(request.auth!, id, body);
  }
}
