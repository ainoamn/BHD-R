import {
  Body,
  ConflictException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { ApiRequest } from '../common/api-http.js';
import { z } from 'zod';
import {
  addressSchema,
  createPropertySchema,
  createUnitSchema,
  listingSearchSchema,
  moneySchema,
} from '@bhd-r/contracts';
import { Idempotent, Public, RequirePermissions } from '../common/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PortfolioService } from './portfolio.service.js';

const propertyBundleSchema = z.object({
  property: createPropertySchema.omit({ organizationId: true }),
  units: z
    .array(createUnitSchema.omit({ propertyId: true }))
    .min(1)
    .max(500),
});
const listingToggleSchema = z.object({ enabled: z.boolean() });
const addUnitSchema = createUnitSchema.omit({ propertyId: true });
const propertyUpdateSchema = z
  .object({
    category: createPropertySchema.shape.category.optional(),
    nameAr: z.string().trim().min(2).max(160).optional(),
    nameEn: z.string().trim().min(2).max(160).optional(),
    descriptionAr: z.string().trim().max(5000).nullable().optional(),
    descriptionEn: z.string().trim().max(5000).nullable().optional(),
    address: addressSchema.partial().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');
const unitUpdateSchema = createUnitSchema
  .omit({ propertyId: true, publishWhenAvailable: true, salePrice: true, deposit: true })
  .partial()
  .extend({
    salePrice: moneySchema.nullable().optional(),
    deposit: moneySchema.nullable().optional(),
    status: z.enum(['active', 'inactive']).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');
const publicViewingSchema = z
  .object({
    submissionId: z.uuid(),
    unitId: z.uuid(),
    displayName: z.string().trim().min(2).max(160),
    email: z.email().max(320),
    phone: z.string().trim().min(6).max(40).optional(),
    preferredAt: z.iso.datetime().optional(),
    notes: z.string().trim().max(2000).optional(),
    locale: z.enum(['ar', 'en']).default('ar'),
    consent: z.literal(true),
    website: z.string().max(200).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.preferredAt) return;
    const preferred = new Date(value.preferredAt).getTime();
    const now = Date.now();
    if (preferred < now + 60 * 60 * 1000 || preferred > now + 180 * 24 * 60 * 60 * 1000)
      context.addIssue({
        code: 'custom',
        path: ['preferredAt'],
        message: 'Preferred time must be between one hour and 180 days from now',
      });
  });

@Controller('v1/portfolio')
export class PortfolioController {
  constructor(private readonly service: PortfolioService) {}

  @RequirePermissions('property.read', 'unit.read')
  @Get('properties')
  list(@Req() request: ApiRequest) {
    return this.service.listProperties(request.auth!);
  }

  @RequirePermissions('property.create', 'unit.create')
  @Idempotent()
  @Post('properties')
  create(
    @Req() request: ApiRequest,
    @Body(new ZodPipe(propertyBundleSchema)) body: z.infer<typeof propertyBundleSchema>,
  ) {
    return this.service.createProperty(request.auth!, body);
  }

  @RequirePermissions('property.read', 'unit.read')
  @Get('properties/:id')
  get(@Req() request: ApiRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getProperty(request.auth!, id);
  }

  @RequirePermissions('property.update')
  @Patch('properties/:id')
  updateProperty(
    @Req() request: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(propertyUpdateSchema)) body: z.infer<typeof propertyUpdateSchema>,
  ) {
    return this.service.updateProperty(request.auth!, id, body);
  }

  @RequirePermissions('unit.update')
  @Patch('properties/:id/deposit')
  updatePropertyDeposit(
    @Req() request: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(
      new ZodPipe(
        z.object({
          amountMinor: z.string().regex(/^\d+$/),
          currency: z.string().min(3).max(3).optional(),
        }),
      ),
    )
    body: { amountMinor: string; currency?: string },
  ) {
    return this.service.updatePropertyDeposit(request.auth!, id, body);
  }

  @RequirePermissions('property.archive')
  @Patch('properties/:id/archive')
  archiveProperty(@Req() request: ApiRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.archiveProperty(request.auth!, id);
  }

  @RequirePermissions('property.archive')
  @Patch('properties/:id/restore')
  restoreProperty(@Req() request: ApiRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.restoreProperty(request.auth!, id);
  }

  @RequirePermissions('property.update', 'unit.create')
  @Idempotent()
  @Post('properties/:id/units')
  addUnit(
    @Req() request: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(addUnitSchema)) body: z.infer<typeof addUnitSchema>,
  ) {
    return this.service.addUnit(request.auth!, id, body);
  }

  @RequirePermissions('unit.update')
  @Patch('units/:id')
  updateUnit(
    @Req() request: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(unitUpdateSchema)) body: z.infer<typeof unitUpdateSchema>,
  ) {
    return this.service.updateUnit(request.auth!, id, body);
  }

  @RequirePermissions('unit.publish')
  @Patch('units/:id/listing')
  toggle(
    @Req() request: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(listingToggleSchema)) body: z.infer<typeof listingToggleSchema>,
  ) {
    return this.service.setListing(request.auth!, id, body.enabled);
  }
}

@Public()
@Controller('v1/public/listings')
export class PublicListingsController {
  constructor(private readonly service: PortfolioService) {}

  @Get()
  search(@Query(new ZodPipe(listingSearchSchema)) query: z.infer<typeof listingSearchSchema>) {
    return this.service.searchPublic(query);
  }

  @Get(':slug')
  get(@Param('slug') slug: string) {
    return this.service.publicBySlug(slug);
  }
}

@Public()
@Controller('v1/public/units')
export class PublicUnitsController {
  constructor(private readonly service: PortfolioService) {}
  @Get(':id')
  unit(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.publicUnitById(id);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(':id/viewing-requests')
  viewing(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(publicViewingSchema)) body: z.infer<typeof publicViewingSchema>,
  ) {
    if (id !== body.unitId) throw new ConflictException('Unit identifier mismatch');
    return this.service.createPublicViewingRequest(body);
  }
}

@Public()
@Controller('v1/public/properties')
export class PublicPropertiesController {
  constructor(private readonly service: PortfolioService) {}
  @Get(':id')
  property(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.publicPropertyById(id);
  }
}
