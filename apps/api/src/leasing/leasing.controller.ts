import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createHoldSchema, createLeaseSchema } from '@bhd-r/contracts';
import { Idempotent, RequirePermissions } from '../common/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { LeasingService } from './leasing.service.js';

const reservationSchema = z.object({
  unitId: z.uuid(),
  tenantPartyId: z.uuid(),
  expiresAt: z.iso.datetime(),
});
const leaseSchema = createLeaseSchema.extend({
  additionalTerms: z.string().max(10_000).optional(),
  reservationId: z.uuid().optional(),
});
const challengeSchema = z.discriminatedUnion('authenticationMethod', [
  z.object({ authenticationMethod: z.literal('oidc_reauthentication') }),
  z.object({ authenticationMethod: z.literal('totp'), totpCode: z.string().regex(/^\d{6}$/) }),
]);
const signingSchema = z
  .object({ challengeId: z.uuid(), consentTextVersion: z.string().min(1).max(80) })
  .strict();

@Controller('v1/leasing')
export class LeasingController {
  constructor(private readonly service: LeasingService) {}

  @RequirePermissions('reservation.manage')
  @Idempotent()
  @Post('holds')
  createHold(
    @Req() request: FastifyRequest,
    @Body(new ZodPipe(createHoldSchema)) body: z.infer<typeof createHoldSchema>,
  ) {
    return this.service.createHold(request.auth!, body);
  }

  @RequirePermissions('reservation.manage')
  @Idempotent()
  @Post('reservations')
  createReservation(
    @Req() request: FastifyRequest,
    @Body(new ZodPipe(reservationSchema)) body: z.infer<typeof reservationSchema>,
  ) {
    return this.service.createReservation(request.auth!, body);
  }

  @RequirePermissions('lease.create', 'contract.create')
  @Idempotent()
  @Post('leases')
  createLease(
    @Req() request: FastifyRequest,
    @Body(new ZodPipe(leaseSchema)) body: z.infer<typeof leaseSchema>,
  ) {
    return this.service.createLeaseAndContract(request.auth!, body);
  }

  @RequirePermissions('contract.send')
  @Idempotent()
  @Post('contracts/:id/send')
  send(@Req() request: FastifyRequest, @Param('id') id: string) {
    return this.service.sendContract(request.auth!, id);
  }

  @RequirePermissions('contract.sign')
  @Idempotent()
  @Post('contracts/:id/signature-challenges')
  challenge(
    @Req() request: FastifyRequest,
    @Param('id') id: string,
    @Body(new ZodPipe(challengeSchema)) body: z.infer<typeof challengeSchema>,
  ) {
    return this.service.createSignatureChallenge(
      request.auth!,
      id,
      body.authenticationMethod,
      'totpCode' in body ? body.totpCode : undefined,
    );
  }

  @RequirePermissions('contract.sign')
  @Idempotent()
  @Post('contracts/:id/signatures')
  sign(
    @Req() request: FastifyRequest,
    @Param('id') id: string,
    @Body(new ZodPipe(signingSchema)) body: z.infer<typeof signingSchema>,
  ) {
    return this.service.signContract(request.auth!, id, {
      ...body,
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
    });
  }

  @RequirePermissions('lease.read')
  @Get('leases')
  list(@Req() request: FastifyRequest) {
    return this.service.listTenantLeases(request.auth!);
  }

  @RequirePermissions('reservation.read')
  @Get('holds')
  holds(@Req() request: FastifyRequest) {
    return this.service.listHolds(request.auth!);
  }

  @RequirePermissions('reservation.manage')
  @Patch('holds/:id/cancel')
  cancelHold(@Req() request: FastifyRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.cancelHold(request.auth!, id);
  }

  @RequirePermissions('reservation.read')
  @Get('reservations')
  reservations(@Req() request: FastifyRequest) {
    return this.service.listReservations(request.auth!);
  }

  @RequirePermissions('reservation.manage')
  @Patch('reservations/:id')
  updateReservation(
    @Req() request: FastifyRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(
      new ZodPipe(
        z
          .object({
            status: z.enum(['confirmed', 'cancelled']),
            note: z.string().max(5000).optional(),
          })
          .strict(),
      ),
    )
    body: { status: 'confirmed' | 'cancelled'; note?: string },
  ) {
    return this.service.updateReservation(request.auth!, id, body);
  }

  @RequirePermissions('contract.read')
  @Get('contracts')
  contracts(@Req() request: FastifyRequest) {
    return this.service.listContracts(request.auth!);
  }

  @RequirePermissions('lease.update')
  @Patch('leases/:id')
  updateLease(
    @Req() request: FastifyRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(
      new ZodPipe(
        z
          .object({
            action: z.enum(['activate', 'end', 'terminate', 'renew']),
            endsOn: z.iso.date().optional(),
            note: z.string().max(5000).optional(),
          })
          .strict(),
      ),
    )
    body: {
      action: 'activate' | 'end' | 'terminate' | 'renew';
      endsOn?: string;
      note?: string;
    },
  ) {
    return this.service.updateLease(request.auth!, id, body);
  }
}
