import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import type { ApiRequest } from '../common/api-http.js';
import { z } from 'zod';
import { currencyCodeSchema } from '@bhd-r/contracts';
import { Idempotent, RequirePermissions } from '../common/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { OperationsService } from './operations.service.js';

const optionalUuid = z.uuid().optional();
const prioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);
const workflowStatusSchema = z.enum([
  'draft',
  'pending',
  'approved',
  'in_progress',
  'on_hold',
  'completed',
  'rejected',
  'cancelled',
]);
const requestSchema = z
  .object({
    type: z.string().min(2).max(60),
    subject: z.string().min(2).max(200),
    description: z.string().max(10_000).optional(),
    priority: prioritySchema.default('normal'),
    propertyId: optionalUuid,
    unitId: optionalUuid,
    requesterPartyId: optionalUuid,
    dueAt: z.iso.datetime().optional(),
  })
  .strict();
const taskSchema = z
  .object({
    title: z.string().min(2).max(200),
    description: z.string().max(10_000).optional(),
    category: z.string().min(2).max(60),
    priority: prioritySchema.default('normal'),
    assignedToUserId: optionalUuid,
    propertyId: optionalUuid,
    unitId: optionalUuid,
    relatedType: z.string().max(60).optional(),
    relatedId: optionalUuid,
    startsAt: z.iso.datetime().optional(),
    dueAt: z.iso.datetime().optional(),
    checklist: z
      .array(z.object({ label: z.string().min(1).max(200), done: z.boolean() }).strict())
      .max(100)
      .optional(),
  })
  .strict();
const viewingSchema = z
  .object({
    unitId: z.uuid(),
    prospectPartyId: z.uuid(),
    assignedToUserId: optionalUuid,
    channel: z.string().min(2).max(40).default('website'),
    preferredAt: z.iso.datetime().optional(),
    scheduledAt: z.iso.datetime().optional(),
    notes: z.string().max(5000).optional(),
  })
  .strict();
const viewingStatusSchema = z.enum([
  'requested',
  'scheduled',
  'completed',
  'no_show',
  'cancelled',
  'converted',
]);
const saleSchema = z
  .object({
    propertyId: z.uuid(),
    unitId: optionalUuid,
    sellerPartyId: z.uuid(),
    buyerPartyId: optionalUuid,
    assignedToUserId: optionalUuid,
    askingPriceMinor: z.string().regex(/^\d+$/),
    offerPriceMinor: z.string().regex(/^\d+$/).optional(),
    commissionMinor: z.string().regex(/^\d+$/).optional(),
    currency: currencyCodeSchema,
    expectedClosingOn: z.iso.date().optional(),
    notes: z.string().max(5000).optional(),
  })
  .strict();
const salesStatusSchema = z.enum([
  'lead',
  'qualified',
  'viewing',
  'offer',
  'negotiation',
  'reserved',
  'contracting',
  'closed_won',
  'closed_lost',
  'cancelled',
]);
const vendorSchema = z
  .object({
    partyId: optionalUuid,
    code: z.string().min(2).max(64).optional(),
    name: z.string().min(2).max(200),
    category: z.string().min(2).max(80),
    phone: z.string().max(40).optional(),
    email: z.email().optional(),
  })
  .strict();
const workOrderSchema = z
  .object({
    ticketId: z.uuid(),
    vendorId: optionalUuid,
    assignedToUserId: optionalUuid,
    scope: z.string().min(2).max(10_000),
    scheduledAt: z.iso.datetime().optional(),
    estimateMinor: z.string().regex(/^\d+$/).optional(),
    currency: currencyCodeSchema,
  })
  .strict();
const workOrderStatusSchema = z.enum([
  'draft',
  'quoted',
  'awaiting_approval',
  'approved',
  'scheduled',
  'in_progress',
  'completed',
  'verified',
  'cancelled',
]);
const legalCaseSchema = z
  .object({
    caseNumber: z.string().max(120).optional(),
    caseType: z.string().min(2).max(80),
    title: z.string().min(2).max(240),
    description: z.string().max(20_000).optional(),
    propertyId: optionalUuid,
    unitId: optionalUuid,
    leaseId: optionalUuid,
    counterpartyId: optionalUuid,
    lawyerPartyId: optionalUuid,
    assignedToUserId: optionalUuid,
    court: z.string().max(200).optional(),
    claimAmountMinor: z.string().regex(/^\d+$/).optional(),
    currency: currencyCodeSchema,
    openedOn: z.iso.date(),
    nextHearingAt: z.iso.datetime().optional(),
  })
  .strict();
const legalStatusSchema = z.enum([
  'assessment',
  'notice',
  'filed',
  'hearing',
  'judgment',
  'enforcement',
  'settled',
  'closed',
  'cancelled',
]);
const legalEventSchema = z
  .object({
    type: z.string().min(2).max(60),
    title: z.string().min(2).max(200),
    notes: z.string().max(10_000).optional(),
    occurredAt: z.iso.datetime().optional(),
    deadlineAt: z.iso.datetime().optional(),
  })
  .strict();
const statusNote = <T extends z.ZodType>(status: T) =>
  z.object({ status, note: z.string().max(5000).optional() }).strict();

@Controller('v1/operations')
export class OperationsController {
  constructor(private readonly service: OperationsService) {}

  @RequirePermissions('organization.read')
  @Get('dashboard')
  dashboard(@Req() request: ApiRequest) {
    return this.service.dashboard(request.auth!);
  }

  @RequirePermissions('organization.read')
  @Get('context')
  context(@Req() request: ApiRequest) {
    return this.service.context(request.auth!);
  }

  @RequirePermissions('request.read')
  @Get('requests')
  requests(@Req() request: ApiRequest) {
    return this.service.listRequests(request.auth!);
  }

  @RequirePermissions('request.create')
  @Idempotent()
  @Post('requests')
  createRequest(
    @Req() request: ApiRequest,
    @Body(new ZodPipe(requestSchema)) body: z.infer<typeof requestSchema>,
  ) {
    return this.service.createRequest(request.auth!, body);
  }

  @RequirePermissions('request.update')
  @Patch('requests/:id')
  updateRequest(
    @Req() request: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(statusNote(workflowStatusSchema)))
    body: { status: z.infer<typeof workflowStatusSchema>; note?: string },
  ) {
    return this.service.updateRequest(request.auth!, id, body);
  }

  @RequirePermissions('task.read')
  @Get('tasks')
  tasks(@Req() request: ApiRequest) {
    return this.service.listTasks(request.auth!);
  }

  @RequirePermissions('task.create')
  @Idempotent()
  @Post('tasks')
  createTask(
    @Req() request: ApiRequest,
    @Body(new ZodPipe(taskSchema)) body: z.infer<typeof taskSchema>,
  ) {
    return this.service.createTask(request.auth!, body);
  }

  @RequirePermissions('task.update')
  @Patch('tasks/:id')
  updateTask(
    @Req() request: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(statusNote(workflowStatusSchema)))
    body: { status: z.infer<typeof workflowStatusSchema>; note?: string },
  ) {
    return this.service.updateTask(request.auth!, id, body);
  }

  @RequirePermissions('viewing.read')
  @Get('viewings')
  viewings(@Req() request: ApiRequest) {
    return this.service.listViewings(request.auth!);
  }

  @RequirePermissions('viewing.manage')
  @Idempotent()
  @Post('viewings')
  createViewing(
    @Req() request: ApiRequest,
    @Body(new ZodPipe(viewingSchema)) body: z.infer<typeof viewingSchema>,
  ) {
    return this.service.createViewing(request.auth!, body);
  }

  @RequirePermissions('viewing.manage')
  @Patch('viewings/:id')
  updateViewing(
    @Req() request: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(statusNote(viewingStatusSchema)))
    body: { status: z.infer<typeof viewingStatusSchema>; note?: string },
  ) {
    return this.service.updateViewing(request.auth!, id, body);
  }

  @RequirePermissions('sale.read')
  @Get('sales')
  sales(@Req() request: ApiRequest) {
    return this.service.listSales(request.auth!);
  }

  @RequirePermissions('sale.read')
  @Get('sales/totals')
  salesTotals(@Req() request: ApiRequest) {
    return this.service.ensureSalesTotals(request.auth!);
  }

  @RequirePermissions('sale.manage')
  @Idempotent()
  @Post('sales')
  createSale(
    @Req() request: ApiRequest,
    @Body(new ZodPipe(saleSchema)) body: z.infer<typeof saleSchema>,
  ) {
    return this.service.createSale(request.auth!, body);
  }

  @RequirePermissions('sale.manage')
  @Patch('sales/:id')
  updateSale(
    @Req() request: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(
      new ZodPipe(
        statusNote(salesStatusSchema).extend({
          agreedPriceMinor: z.string().regex(/^\d+$/).optional(),
        }),
      ),
    )
    body: {
      status: z.infer<typeof salesStatusSchema>;
      agreedPriceMinor?: string;
      note?: string;
    },
  ) {
    return this.service.updateSale(request.auth!, id, body);
  }

  @RequirePermissions('vendor.read')
  @Get('vendors')
  vendors(@Req() request: ApiRequest) {
    return this.service.listVendors(request.auth!);
  }

  @RequirePermissions('vendor.manage')
  @Idempotent()
  @Post('vendors')
  createVendor(
    @Req() request: ApiRequest,
    @Body(new ZodPipe(vendorSchema)) body: z.infer<typeof vendorSchema>,
  ) {
    return this.service.createVendor(request.auth!, body);
  }

  @RequirePermissions('work_order.read')
  @Get('work-orders')
  workOrders(@Req() request: ApiRequest) {
    return this.service.listWorkOrders(request.auth!);
  }

  @RequirePermissions('work_order.manage')
  @Idempotent()
  @Post('work-orders')
  createWorkOrder(
    @Req() request: ApiRequest,
    @Body(new ZodPipe(workOrderSchema)) body: z.infer<typeof workOrderSchema>,
  ) {
    return this.service.createWorkOrder(request.auth!, body);
  }

  @RequirePermissions('work_order.manage')
  @Patch('work-orders/:id')
  updateWorkOrder(
    @Req() request: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(
      new ZodPipe(
        statusNote(workOrderStatusSchema).extend({
          approvedMinor: z.string().regex(/^\d+$/).optional(),
          actualMinor: z.string().regex(/^\d+$/).optional(),
          completionNotes: z.string().max(10_000).optional(),
        }),
      ),
    )
    body: {
      status: z.infer<typeof workOrderStatusSchema>;
      approvedMinor?: string;
      actualMinor?: string;
      completionNotes?: string;
      note?: string;
    },
  ) {
    return this.service.updateWorkOrder(request.auth!, id, body);
  }

  @RequirePermissions('legal.read')
  @Get('legal-cases')
  legalCases(@Req() request: ApiRequest) {
    return this.service.listLegalCases(request.auth!);
  }

  @RequirePermissions('legal.manage')
  @Idempotent()
  @Post('legal-cases')
  createLegalCase(
    @Req() request: ApiRequest,
    @Body(new ZodPipe(legalCaseSchema)) body: z.infer<typeof legalCaseSchema>,
  ) {
    return this.service.createLegalCase(request.auth!, body);
  }

  @RequirePermissions('legal.manage')
  @Patch('legal-cases/:id')
  updateLegalCase(
    @Req() request: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(
      new ZodPipe(
        statusNote(legalStatusSchema).extend({
          recoveredAmountMinor: z.string().regex(/^\d+$/).optional(),
        }),
      ),
    )
    body: {
      status: z.infer<typeof legalStatusSchema>;
      recoveredAmountMinor?: string;
      note?: string;
    },
  ) {
    return this.service.updateLegalCase(request.auth!, id, body);
  }

  @RequirePermissions('legal.read')
  @Get('legal-cases/:id/events')
  legalEvents(@Req() request: ApiRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.listLegalEvents(request.auth!, id);
  }

  @RequirePermissions('legal.manage')
  @Idempotent()
  @Post('legal-cases/:id/events')
  addLegalEvent(
    @Req() request: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(legalEventSchema)) body: z.infer<typeof legalEventSchema>,
  ) {
    return this.service.addLegalEvent(request.auth!, id, body);
  }

  @RequirePermissions('approval.read')
  @Get('approvals')
  approvals(@Req() request: ApiRequest) {
    return this.service.listApprovals(request.auth!);
  }

  @RequirePermissions('approval.decide')
  @Patch('approvals/:id')
  decideApproval(
    @Req() request: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(
      new ZodPipe(
        z
          .object({
            decision: z.enum(['approved', 'rejected']),
            note: z.string().max(5000).optional(),
          })
          .strict(),
      ),
    )
    body: { decision: 'approved' | 'rejected'; note?: string },
  ) {
    return this.service.decideApproval(request.auth!, id, body);
  }

  @RequirePermissions('organization.read')
  @Get('timeline/:resourceType/:resourceId')
  timeline(
    @Req() request: ApiRequest,
    @Param('resourceType') resourceType: string,
    @Param('resourceId', ParseUUIDPipe) resourceId: string,
  ) {
    return this.service.timeline(request.auth!, resourceType, resourceId);
  }
}
