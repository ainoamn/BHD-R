import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Idempotent, RequirePermissions } from '../common/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { ReportsService } from './reports.service.js';

const reportSchema = z.object({
  type: z.enum([
    'occupancy',
    'rent_roll',
    'income',
    'arrears',
    'maintenance',
    'portfolio',
    'sales_pipeline',
    'legal_cases',
    'task_performance',
    'requests',
    'trial_balance',
    'general_ledger',
    'expenses',
  ]),
  format: z.enum(['csv', 'xlsx', 'pdf']),
  filters: z.record(z.string(), z.unknown()).default({}),
});
@Controller('v1/reports')
export class ReportsController {
  constructor(private readonly service: ReportsService) {}
  @RequirePermissions('report.read') @Get() list(@Req() request: FastifyRequest) {
    return this.service.list(request.auth!);
  }
  @RequirePermissions('report.read') @Get('operational-summary') summary(
    @Req() request: FastifyRequest,
  ) {
    return this.service.operationalSummary(request.auth!);
  }
  @RequirePermissions('report.read') @Get(':id') get(
    @Req() request: FastifyRequest,
    @Param('id') id: string,
  ) {
    return this.service.get(request.auth!, id);
  }
  @RequirePermissions('report.read') @Get(':id/download') download(
    @Req() request: FastifyRequest,
    @Param('id') id: string,
  ) {
    return this.service.download(request.auth!, id);
  }
  @RequirePermissions('report.export') @Idempotent() @Post() create(
    @Req() request: FastifyRequest,
    @Body(new ZodPipe(reportSchema)) body: z.infer<typeof reportSchema>,
  ) {
    return this.service.create(request.auth!, body);
  }
}
