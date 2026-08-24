import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { currencyCodeSchema } from '@bhd-r/contracts';
import { Idempotent, RequirePermissions } from '../common/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AccountingService } from './accounting.service.js';

const optionalUuid = z.uuid().optional();
const accountSchema = z
  .object({
    parentId: optionalUuid,
    code: z.string().min(1).max(40),
    nameAr: z.string().min(2).max(160),
    nameEn: z.string().min(2).max(160),
    type: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']),
    currency: currencyCodeSchema.optional(),
  })
  .strict();
const journalLineSchema = z
  .object({
    accountId: z.uuid(),
    partyId: optionalUuid,
    propertyId: optionalUuid,
    unitId: optionalUuid,
    debitMinor: z.string().regex(/^\d+$/),
    creditMinor: z.string().regex(/^\d+$/),
    currency: currencyCodeSchema,
    memo: z.string().max(500).optional(),
  })
  .strict();
const journalSchema = z
  .object({
    occurredOn: z.iso.date(),
    description: z.string().min(2).max(500),
    sourceType: z.string().max(60).optional(),
    sourceId: optionalUuid,
    lines: z.array(journalLineSchema).min(2).max(200),
  })
  .strict();
const expenseSchema = z
  .object({
    propertyId: optionalUuid,
    unitId: optionalUuid,
    vendorId: optionalUuid,
    workOrderId: optionalUuid,
    category: z.string().min(2).max(80),
    description: z.string().min(2).max(500),
    amountMinor: z.string().regex(/^[1-9]\d*$/),
    taxMinor: z.string().regex(/^\d+$/).optional(),
    currency: currencyCodeSchema,
    issuedOn: z.iso.date(),
    dueOn: z.iso.date().optional(),
    notes: z.string().max(10_000).optional(),
  })
  .strict();
const expenseStatusSchema = z.enum([
  'draft',
  'pending',
  'approved',
  'in_progress',
  'on_hold',
  'completed',
  'rejected',
  'cancelled',
]);

@Controller('v1/accounting')
export class AccountingController {
  constructor(private readonly service: AccountingService) {}

  @RequirePermissions('accounting.read')
  @Get('dashboard')
  dashboard(@Req() request: FastifyRequest) {
    return this.service.dashboard(request.auth!);
  }

  @RequirePermissions('accounting.read')
  @Get('accounts')
  accounts(@Req() request: FastifyRequest) {
    return this.service.listAccounts(request.auth!);
  }

  @RequirePermissions('accounting.manage')
  @Idempotent()
  @Post('accounts/bootstrap')
  bootstrap(@Req() request: FastifyRequest) {
    return this.service.bootstrapChart(request.auth!);
  }

  @RequirePermissions('accounting.manage')
  @Idempotent()
  @Post('accounts')
  createAccount(
    @Req() request: FastifyRequest,
    @Body(new ZodPipe(accountSchema)) body: z.infer<typeof accountSchema>,
  ) {
    return this.service.createAccount(request.auth!, body);
  }

  @RequirePermissions('accounting.read')
  @Get('journals')
  journals(@Req() request: FastifyRequest) {
    return this.service.listJournals(request.auth!);
  }

  @RequirePermissions('accounting.read')
  @Get('journals/:id')
  journal(@Req() request: FastifyRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getJournal(request.auth!, id);
  }

  @RequirePermissions('accounting.manage')
  @Idempotent()
  @Post('journals')
  createJournal(
    @Req() request: FastifyRequest,
    @Body(new ZodPipe(journalSchema)) body: z.infer<typeof journalSchema>,
  ) {
    return this.service.createJournal(request.auth!, body);
  }

  @RequirePermissions('accounting.post')
  @Idempotent()
  @Post('journals/:id/post')
  postJournal(@Req() request: FastifyRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.postJournal(request.auth!, id);
  }

  @RequirePermissions('accounting.post')
  @Idempotent()
  @Post('journals/:id/reverse')
  reverseJournal(
    @Req() request: FastifyRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(
      new ZodPipe(
        z
          .object({
            occurredOn: z.iso.date(),
            note: z.string().max(500).optional(),
          })
          .strict(),
      ),
    )
    body: { occurredOn: string; note?: string },
  ) {
    return this.service.reverseJournal(request.auth!, id, body.occurredOn, body.note);
  }

  @RequirePermissions('accounting.read')
  @Get('trial-balance')
  trialBalance(@Req() request: FastifyRequest) {
    return this.service.trialBalance(request.auth!);
  }

  @RequirePermissions('accounting.read')
  @Get('expenses')
  expenses(@Req() request: FastifyRequest) {
    return this.service.listExpenses(request.auth!);
  }

  @RequirePermissions('accounting.manage')
  @Idempotent()
  @Post('expenses')
  createExpense(
    @Req() request: FastifyRequest,
    @Body(new ZodPipe(expenseSchema)) body: z.infer<typeof expenseSchema>,
  ) {
    return this.service.createExpense(request.auth!, body);
  }

  @RequirePermissions('accounting.manage')
  @Patch('expenses/:id')
  updateExpense(
    @Req() request: FastifyRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(
      new ZodPipe(
        z
          .object({
            status: expenseStatusSchema,
            note: z.string().max(5000).optional(),
          })
          .strict(),
      ),
    )
    body: { status: z.infer<typeof expenseStatusSchema>; note?: string },
  ) {
    return this.service.updateExpense(request.auth!, id, body);
  }
}
