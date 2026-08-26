import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { ApiRequest } from '../common/api-http.js';
import { z } from 'zod';
import { Idempotent, RequirePermissions } from '../common/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PartiesService } from './parties.service.js';

const roleSchema = z.enum([
  'prospect',
  'tenant',
  'owner',
  'supplier',
  'partner',
  'government',
  'authorized_representative',
  'lawyer',
  'other',
]);
const profileSchema = z
  .record(z.string().max(80), z.union([z.string().max(500), z.array(z.string().max(80)), z.null()]))
  .optional();
const addressSchema = z
  .object({
    label: z.string().trim().min(1).max(40).optional(),
    primary: z.boolean().optional(),
    countryCode: z.string().length(2).default('OM'),
    governorate: z.string().trim().min(1).max(120),
    wilayat: z.string().trim().min(1).max(120),
    city: z.string().trim().min(1).max(120),
    area: z.string().trim().max(120).optional(),
    street: z.string().trim().max(160).optional(),
    buildingNumber: z.string().trim().max(50).optional(),
    postalCode: z.string().trim().max(24).optional(),
  })
  .strict();
const identityDocumentSchema = z
  .object({
    documentType: z.enum(['civil_id', 'passport', 'commercial_registration', 'tax_card', 'other']),
    number: z.string().trim().min(3).max(120),
    issuingCountryCode: z.string().length(2).default('OM'),
    issuedOn: z.iso.date().optional(),
    expiresOn: z.iso.date().optional(),
  })
  .strict()
  .refine((value) => !value.issuedOn || !value.expiresOn || value.expiresOn >= value.issuedOn, {
    message: 'Document expiry cannot precede issue date',
    path: ['expiresOn'],
  });
const createPartySchema = z
  .object({
    type: z.enum(['person', 'company']),
    displayName: z.string().trim().min(2).max(200),
    email: z.email().max(320).optional(),
    phone: z.string().trim().min(5).max(40).optional(),
    roles: z.array(roleSchema).min(1).max(12),
    profile: profileSchema,
    address: addressSchema.optional(),
    identityDocuments: z.array(identityDocumentSchema).max(20).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const hasRegistration = value.identityDocuments?.some(
      (document) => document.documentType === 'commercial_registration',
    );
    if (value.type === 'company' && !hasRegistration) {
      context.addIssue({
        code: 'custom',
        message: 'Company requires a commercial registration document',
        path: ['identityDocuments'],
      });
    }
  });
const updatePartySchema = z
  .object({
    displayName: z.string().trim().min(2).max(200).optional(),
    email: z.email().max(320).nullable().optional(),
    phone: z.string().trim().min(5).max(40).nullable().optional(),
    roles: z.array(roleSchema).min(1).max(12).optional(),
    profile: profileSchema,
  })
  .strict();
const listQuerySchema = z
  .object({
    role: roleSchema.optional(),
    query: z.string().trim().max(160).optional(),
    includeArchived: z.enum(['true', 'false']).optional(),
  })
  .strict();
const representativeSchema = z
  .object({
    representativePartyId: z.uuid(),
    title: z.string().trim().min(2).max(160),
    scopes: z.array(z.string().trim().min(1).max(80)).min(1).max(30),
    startsOn: z.iso.date().optional(),
    endsOn: z.iso.date().optional(),
  })
  .strict()
  .refine((value) => !value.startsOn || !value.endsOn || value.endsOn >= value.startsOn, {
    message: 'Authority end date cannot precede its start date',
    path: ['endsOn'],
  });

@Controller('v1/parties')
export class PartiesController {
  constructor(private readonly service: PartiesService) {}

  @RequirePermissions('party.read')
  @Get()
  list(
    @Req() request: ApiRequest,
    @Query(new ZodPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ) {
    return this.service.list(request.auth!, {
      ...query,
      includeArchived: query.includeArchived === 'true',
    });
  }

  @RequirePermissions('party.read')
  @Get(':id')
  get(
    @Req() request: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('includeSensitive') includeSensitive?: string,
  ) {
    const requested = includeSensitive === 'true';
    const allowed = request.auth!.permissions.includes('party.sensitive.read');
    return this.service.get(request.auth!, id, requested && allowed);
  }

  @RequirePermissions('party.write')
  @Idempotent()
  @Post()
  create(
    @Req() request: ApiRequest,
    @Body(new ZodPipe(createPartySchema)) body: z.infer<typeof createPartySchema>,
  ) {
    return this.service.create(request.auth!, body);
  }

  @RequirePermissions('party.write')
  @Patch(':id')
  update(
    @Req() request: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updatePartySchema)) body: z.infer<typeof updatePartySchema>,
  ) {
    return this.service.update(request.auth!, id, body);
  }

  @RequirePermissions('party.write')
  @Idempotent()
  @Post(':id/addresses')
  address(
    @Req() request: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(addressSchema)) body: z.infer<typeof addressSchema>,
  ) {
    return this.service.addAddress(request.auth!, id, body);
  }

  @RequirePermissions('party.write')
  @Idempotent()
  @Post(':id/identity-documents')
  identityDocument(
    @Req() request: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(identityDocumentSchema)) body: z.infer<typeof identityDocumentSchema>,
  ) {
    return this.service.addIdentityDocument(request.auth!, id, body);
  }

  @RequirePermissions('party.representative.manage')
  @Idempotent()
  @Post(':id/representatives')
  representative(
    @Req() request: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(representativeSchema)) body: z.infer<typeof representativeSchema>,
  ) {
    return this.service.addRepresentative(request.auth!, id, body);
  }

  @RequirePermissions('party.representative.manage')
  @Post(':id/representatives/:authorityId/revoke')
  revokeRepresentative(
    @Req() request: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('authorityId', ParseUUIDPipe) authorityId: string,
  ) {
    return this.service.revokeRepresentative(request.auth!, id, authorityId);
  }

  @RequirePermissions('party.write')
  @Delete(':id')
  archive(@Req() request: ApiRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.archive(request.auth!, id);
  }
}
