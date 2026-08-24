import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { roleKeySchema } from '@bhd-r/authz';
import { Idempotent, RequirePermissions } from '../common/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { OrganizationsService } from './organizations.service.js';

const representativeSchema = z.object({
  email: z.email(),
  displayName: z.string().trim().min(2).max(160),
  roleKey: roleKeySchema.exclude(['platform_admin', 'platform_support', 'tenant']),
  partyId: z.uuid().optional(),
});
const memberStatusSchema = z
  .object({
    roleKey: roleKeySchema,
    status: z.enum(['active', 'inactive']),
  })
  .strict();

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

  @RequirePermissions('organization.members.write')
  @Idempotent()
  @Patch('current/members/:userId')
  updateMember(
    @Req() request: FastifyRequest,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodPipe(memberStatusSchema)) body: z.infer<typeof memberStatusSchema>,
  ) {
    return this.service.updateMember(request.auth!, userId, body);
  }
}
