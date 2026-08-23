import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { roleKeySchema } from '@bhd-r/authz';
import { RequirePermissions } from '../common/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { OrganizationsService } from './organizations.service.js';

const representativeSchema = z.object({
  email: z.email(),
  displayName: z.string().trim().min(2).max(160),
  roleKey: roleKeySchema.exclude(['platform_admin', 'platform_support', 'tenant']),
  partyId: z.uuid().optional(),
});

@Controller('v1/organizations')
export class OrganizationsController {
  constructor(private readonly service: OrganizationsService) {}

  @RequirePermissions('organization.read')
  @Get('current')
  getCurrent(@Req() request: FastifyRequest) {
    return this.service.getCurrent(request.auth!);
  }

  @RequirePermissions('organization.members.read')
  @Get('current/members')
  listMembers(@Req() request: FastifyRequest) {
    return this.service.listMembers(request.auth!);
  }

  @RequirePermissions('organization.members.write')
  @Post('current/representatives')
  addRepresentative(
    @Req() request: FastifyRequest,
    @Body(new ZodPipe(representativeSchema)) body: z.infer<typeof representativeSchema>,
  ) {
    return this.service.addRepresentative(request.auth!, body);
  }
}
