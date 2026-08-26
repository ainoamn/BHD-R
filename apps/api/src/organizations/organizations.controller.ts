import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import type { ApiRequest } from '../common/api-http.js';
import { z } from 'zod';
import { roleKeySchema } from '@bhd-r/authz';
import { Idempotent, Authenticated, RequirePermissions } from '../common/decorators.js';
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
const inviteSchema = z
  .object({
    email: z.email(),
    roleKey: roleKeySchema.exclude(['platform_admin', 'platform_support', 'tenant']),
    principalPartyId: z.uuid().optional(),
    scopes: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
    expiresInHours: z.number().int().min(1).max(168).optional(),
  })
  .strict();
const acceptInviteSchema = z
  .object({
    token: z.string().trim().min(20).max(200),
  })
  .strict();

@Controller('v1/organizations')
export class OrganizationsController {
  constructor(private readonly service: OrganizationsService) {}

  @RequirePermissions('organization.read')
  @Get('current')
  getCurrent(@Req() request: ApiRequest) {
    return this.service.getCurrent(request.auth!);
  }

  @RequirePermissions('organization.members.read')
  @Get('current/members')
  listMembers(@Req() request: ApiRequest) {
    return this.service.listMembers(request.auth!);
  }

  @RequirePermissions('organization.members.write')
  @Post('current/representatives')
  addRepresentative(
    @Req() request: ApiRequest,
    @Body(new ZodPipe(representativeSchema)) body: z.infer<typeof representativeSchema>,
  ) {
    return this.service.addRepresentative(request.auth!, body);
  }

  @RequirePermissions('organization.members.read')
  @Get('current/invitations')
  listInvitations(@Req() request: ApiRequest) {
    return this.service.listInvitations(request.auth!);
  }

  @RequirePermissions('organization.members.write')
  @Idempotent()
  @Post('current/invitations')
  createInvitation(
    @Req() request: ApiRequest,
    @Body(new ZodPipe(inviteSchema)) body: z.infer<typeof inviteSchema>,
  ) {
    return this.service.createInvitation(request.auth!, body);
  }

  @RequirePermissions('organization.members.write')
  @Post('current/invitations/:invitationId/revoke')
  revokeInvitation(
    @Req() request: ApiRequest,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ) {
    return this.service.revokeInvitation(request.auth!, invitationId);
  }

  @Authenticated()
  @Post('invitations/accept')
  acceptInvitation(
    @Req() request: ApiRequest,
    @Body(new ZodPipe(acceptInviteSchema)) body: z.infer<typeof acceptInviteSchema>,
  ) {
    return this.service.acceptInvitation(request.auth!, body.token);
  }

  @RequirePermissions('organization.members.write')
  @Idempotent()
  @Patch('current/members/:userId')
  updateMember(
    @Req() request: ApiRequest,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodPipe(memberStatusSchema)) body: z.infer<typeof memberStatusSchema>,
  ) {
    return this.service.updateMember(request.auth!, userId, body);
  }
}
