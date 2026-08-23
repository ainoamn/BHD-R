import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createPropertySchema, createUnitSchema, listingSearchSchema } from '@bhd-r/contracts';
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

@Controller('v1/portfolio')
export class PortfolioController {
  constructor(private readonly service: PortfolioService) {}

  @RequirePermissions('property.read', 'unit.read')
  @Get('properties')
  list(@Req() request: FastifyRequest) {
    return this.service.listProperties(request.auth!);
  }

  @RequirePermissions('property.create', 'unit.create')
  @Idempotent()
  @Post('properties')
  create(
    @Req() request: FastifyRequest,
    @Body(new ZodPipe(propertyBundleSchema)) body: z.infer<typeof propertyBundleSchema>,
  ) {
    return this.service.createProperty(request.auth!, body);
  }

  @RequirePermissions('unit.publish')
  @Patch('units/:id/listing')
  toggle(
    @Req() request: FastifyRequest,
    @Param('id') id: string,
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
  unit(@Param('id') id: string) {
    return this.service.publicUnitById(id);
  }
}

@Public()
@Controller('v1/public/properties')
export class PublicPropertiesController {
  constructor(private readonly service: PortfolioService) {}
  @Get(':id')
  property(@Param('id') id: string) {
    return this.service.publicPropertyById(id);
  }
}
