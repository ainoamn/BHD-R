import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createHoldSchema, createLeaseSchema } from '@bhd-r/contracts';
import { Idempotent, Authenticated, RequirePermissions } from '../common/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { LeasingService } from './leasing.service.js';

const reservationSchema = z.object({
  unitId: z.uuid(),
  tenantPartyId: z.uuid(),
  expiresAt: z.iso.datetime(),
});
const reservationRequirementSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(/^[a-z0-9_-]+$/),
    labelAr: z.string().trim().min(2).max(200),
    labelEn: z.string().trim().min(2).max(200),
    required: z.boolean().default(true),
    dueAt: z.iso.datetime().optional(),
    notes: z.string().trim().max(5000).optional(),
  })
  .strict();
const reservationDocumentSchema = z
  .object({
    requirementId: z.uuid().optional(),
    mediaAssetId: z.uuid(),
    documentType: z.string().trim().min(2).max(80),
  })
  .strict();
const reservationDocumentReviewSchema = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    notes: z.string().trim().max(5000).optional(),
  })
  .strict();
const leaseSchema = createLeaseSchema.extend({
  additionalTerms: z.string().max(10_000).optional(),
  reservationId: z.uuid().optional(),
});
const renewalSchema = z
  .object({
    templateVersionId: z.uuid(),
    endsOn: z.iso.date(),
    rent: z
      .object({
        amountMinor: z.string().regex(/^\d+$/),
        currency: z.string().regex(/^[A-Z]{3}$/),
      })
      .optional(),
    additionalTerms: z.string().trim().max(10_000).optional(),
    /** Cycle v1.1 R3: optional cheque schedule for the renewed period */
    cheques: z
      .array(
        z.object({
          bankName: z.string().trim().min(2).max(160),
          chequeNumber: z.string().trim().min(1).max(80),
          amount: z.object({
            amountMinor: z.string().regex(/^\d+$/),
            currency: z.string().regex(/^[A-Z]{3}$/),
          }),
          dueOn: z.iso.date(),
        }),
      )
      .max(48)
      .optional()
      .default([]),
  })
  .strict();
const challengeSchema = z.discriminatedUnion('authenticationMethod', [
  z.object({ authenticationMethod: z.literal('recent_sign_in') }),
  z.object({ authenticationMethod: z.literal('oidc_reauthentication') }),
  z.object({ authenticationMethod: z.literal('totp'), totpCode: z.string().regex(/^\d{6}$/) }),
]);
const signingSchema = z
  .object({ challengeId: z.uuid(), consentTextVersion: z.string().min(1).max(80) })
  .strict();
const contractTemplateSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^[a-z0-9-]{3,80}$/),
    language: z.enum(['ar', 'en']),
    html: z.string().min(20).max(200_000),
    active: z.boolean().default(true),
  })
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

  @RequirePermissions('lease.update', 'contract.create')
  @Idempotent()
  @Post('leases/:id/renewals')
  createRenewal(
    @Req() request: FastifyRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(renewalSchema)) body: z.infer<typeof renewalSchema>,
  ) {
    return this.service.createRenewalContract(request.auth!, id, body);
  }

  @RequirePermissions('contract.send')
  @Idempotent()
  @Post('contracts/:id/send')
  send(@Req() request: FastifyRequest, @Param('id') id: string) {
    return this.service.sendContract(request.auth!, id);
  }

  @RequirePermissions('contract.create')
  @Idempotent()
  @Post('contracts/:id/request-approval')
  requestApproval(@Req() request: FastifyRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.requestContractApproval(request.auth!, id);
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

  @RequirePermissions('reservation.read')
  @Get('reservations/:id/compliance')
  reservationCompliance(@Req() request: FastifyRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.reservationCompliance(request.auth!, id);
  }

  @RequirePermissions('reservation.manage')
  @Idempotent()
  @Post('reservations/:id/requirements')
  addReservationRequirement(
    @Req() request: FastifyRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(reservationRequirementSchema))
    body: z.infer<typeof reservationRequirementSchema>,
  ) {
    return this.service.addReservationRequirement(request.auth!, id, body);
  }

  @RequirePermissions('reservation.document.submit')
  @Idempotent()
  @Post('reservations/:id/documents')
  submitReservationDocument(
    @Req() request: FastifyRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(reservationDocumentSchema))
    body: z.infer<typeof reservationDocumentSchema>,
  ) {
    return this.service.submitReservationDocument(request.auth!, id, body);
  }

  @RequirePermissions('reservation.manage')
  @Patch('reservation-documents/:id/review')
  reviewReservationDocument(
    @Req() request: FastifyRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(reservationDocumentReviewSchema))
    body: z.infer<typeof reservationDocumentReviewSchema>,
  ) {
    return this.service.reviewReservationDocument(request.auth!, id, body);
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

  @RequirePermissions('contract.read')
  @Get('contracts/:id')
  contract(@Req() request: FastifyRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.contractDetail(request.auth!, id);
  }

  @RequirePermissions('contract.template.read')
  @Get('contract-templates')
  templates(@Req() request: FastifyRequest, @Query('includeInactive') includeInactive?: string) {
    return this.service.listContractTemplates(request.auth!, includeInactive === 'true');
  }

  @RequirePermissions('contract.template.write')
  @Idempotent()
  @Post('contract-templates')
  template(
    @Req() request: FastifyRequest,
    @Body(new ZodPipe(contractTemplateSchema)) body: z.infer<typeof contractTemplateSchema>,
  ) {
    return this.service.createContractTemplate(request.auth!, body);
  }

  @Authenticated()
  @Patch('leases/:id')
  updateLease(
    @Req() request: FastifyRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(
      new ZodPipe(
        z
          .object({
            action: z.enum([
              'activate',
              'end',
              'terminate',
              'request_cancellation',
              'approve_cancellation',
              'clear_cancellation',
              'confirm_renewal',
              'waive_renewal_gate',
            ]),
            note: z.string().max(5000).optional(),
            proposedEndsOn: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .optional(),
            effectiveOn: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .optional(),
            source: z.enum(['tenant', 'admin']).optional(),
          })
          .strict(),
      ),
    )
    body: {
      action:
        | 'activate'
        | 'end'
        | 'terminate'
        | 'request_cancellation'
        | 'approve_cancellation'
        | 'clear_cancellation'
        | 'confirm_renewal'
        | 'waive_renewal_gate';
      note?: string;
      proposedEndsOn?: string;
      effectiveOn?: string;
      source?: 'tenant' | 'admin';
    },
  ) {
    return this.service.updateLease(request.auth!, id, body);
  }
}
