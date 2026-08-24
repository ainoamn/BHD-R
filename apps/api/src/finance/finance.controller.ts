import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { moneySchema, recordPaymentSchema } from '@bhd-r/contracts';
import { Idempotent, Public, RequirePermissions } from '../common/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { FinanceService } from './finance.service.js';
import { Throttle } from '@nestjs/throttler';

const invoiceSchema = z
  .object({
    leaseId: z.uuid(),
    issuedOn: z.iso.date(),
    dueOn: z.iso.date(),
    lines: z
      .array(
        z.object({
          description: z.string().trim().min(1).max(500),
          quantity: z.string().regex(/^\d+(\.\d{1,3})?$/),
          unitAmount: moneySchema,
          taxRateBasisPoints: z.number().int().min(0).max(10_000).optional(),
        }),
      )
      .min(1)
      .max(100),
    notes: z.string().trim().max(2_000).optional(),
  })
  .refine((value) => value.dueOn >= value.issuedOn, {
    message: 'Due date cannot precede issue date',
    path: ['dueOn'],
  });
const gatewaySchema = z.object({
  provider: z.string().regex(/^[a-z0-9_-]{2,40}$/),
  endpoint: z.url(),
  credentials: z.record(z.string(), z.string().min(1).max(2_000)),
  active: z.boolean().default(false),
});
const refundSchema = z
  .object({
    amountMinor: z.string().regex(/^\d+$/),
    providerReference: z.string().trim().min(1).max(200),
    reason: z.string().trim().min(3).max(500),
    completedAt: z.iso.datetime().optional(),
  })
  .strict();
const billingRunSchema = z.object({ throughOn: z.iso.date().optional() }).strict();
const publicPaymentSessionSchema = z
  .object({
    locale: z.enum(['ar', 'en']).default('ar'),
    returnPath: z.string().regex(/^\/(ar|en)\/invoice\/[A-Za-z0-9_-]{20,200}$/),
  })
  .strict();

@Controller('v1/finance')
export class FinanceController {
  constructor(private readonly service: FinanceService) {}

  @RequirePermissions('invoice.read')
  @Get('invoices')
  list(@Req() request: FastifyRequest) {
    return this.service.listInvoices(request.auth!);
  }

  @RequirePermissions('invoice.create')
  @Idempotent()
  @Post('invoices')
  create(
    @Req() request: FastifyRequest,
    @Body(new ZodPipe(invoiceSchema)) body: z.infer<typeof invoiceSchema>,
  ) {
    return this.service.createInvoice(request.auth!, body);
  }

  @RequirePermissions('invoice.read')
  @Get('invoices/:id/document')
  invoiceDocument(@Req() request: FastifyRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.documentUrl(request.auth!, 'invoice', id);
  }

  @RequirePermissions('payment.record')
  @Idempotent()
  @Post('payments')
  payment(
    @Req() request: FastifyRequest,
    @Body(new ZodPipe(recordPaymentSchema)) body: z.infer<typeof recordPaymentSchema>,
  ) {
    return this.service.recordPayment(request.auth!, body);
  }

  @RequirePermissions('payment.read')
  @Get('payments')
  payments(@Req() request: FastifyRequest) {
    return this.service.listPayments(request.auth!);
  }

  @RequirePermissions('receipt.read')
  @Get('receipts')
  receipts(@Req() request: FastifyRequest) {
    return this.service.listReceipts(request.auth!);
  }

  @RequirePermissions('receipt.read')
  @Get('receipts/:id/document')
  receiptDocument(@Req() request: FastifyRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.documentUrl(request.auth!, 'receipt', id);
  }

  @RequirePermissions('payment.read')
  @Get('refunds')
  refunds(@Req() request: FastifyRequest) {
    return this.service.listRefunds(request.auth!);
  }

  @RequirePermissions('payment.refund')
  @Idempotent()
  @Post('payments/:id/refunds')
  refund(
    @Req() request: FastifyRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(refundSchema)) body: z.infer<typeof refundSchema>,
  ) {
    return this.service.recordRefund(request.auth!, id, body);
  }

  @RequirePermissions('billing.schedule.read')
  @Get('billing-schedules')
  billingSchedules(@Req() request: FastifyRequest) {
    return this.service.listBillingSchedules(request.auth!);
  }

  @RequirePermissions('billing.schedule.manage')
  @Idempotent()
  @Post('billing/run-due')
  runDueBilling(
    @Req() request: FastifyRequest,
    @Body(new ZodPipe(billingRunSchema)) body: z.infer<typeof billingRunSchema>,
  ) {
    return this.service.runDueBilling(request.auth!, body.throughOn);
  }

  @RequirePermissions('invoice.read')
  @Idempotent()
  @Post('invoices/:id/public-link')
  publicLink(@Req() request: FastifyRequest, @Param('id') id: string) {
    return this.service.createPublicLink(request.auth!, id);
  }

  @RequirePermissions('payment.gateway.write')
  @Idempotent()
  @Post('payment-gateways')
  gateway(
    @Req() request: FastifyRequest,
    @Body(new ZodPipe(gatewaySchema)) body: z.infer<typeof gatewaySchema>,
  ) {
    return this.service.configureGateway(request.auth!, body);
  }
}

@Public()
@Controller('v1/public/invoices')
export class PublicInvoiceController {
  constructor(private readonly service: FinanceService) {}

  @Get(':token')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  get(@Param('token') token: string) {
    return this.service.getPublicInvoice(token);
  }

  @Post(':token/payment-sessions')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  paymentSession(
    @Param('token') token: string,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body(new ZodPipe(publicPaymentSessionSchema))
    body: z.infer<typeof publicPaymentSessionSchema>,
  ) {
    if (
      typeof idempotencyKey !== 'string' ||
      idempotencyKey.length < 8 ||
      idempotencyKey.length > 200
    ) {
      throw new BadRequestException('A valid idempotency-key header is required');
    }
    return this.service.createPublicPaymentSession(
      token,
      idempotencyKey,
      body.locale,
      body.returnPath,
    );
  }
}

@Public()
@Controller('v1/public/payment-sessions')
export class PublicPaymentSessionController {
  constructor(private readonly service: FinanceService) {}

  @Post(':reference/sandbox-complete')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  completeSandbox(@Param('reference') reference: string) {
    if (!/^[A-Za-z0-9_-]{24,80}$/.test(reference)) {
      throw new BadRequestException('Invalid payment session reference');
    }
    return this.service.completeSandboxPayment(reference);
  }
}

@Public()
@Controller('v1/internal/billing')
export class InternalBillingController {
  constructor(private readonly service: FinanceService) {}

  @Post('run-due')
  run(
    @Headers('authorization') authorization: string,
    @Body(new ZodPipe(billingRunSchema)) body: z.infer<typeof billingRunSchema>,
  ) {
    const expected = process.env.CRON_SECRET;
    if (!expected || authorization !== `Bearer ${expected}`) {
      throw new UnauthorizedException('Invalid scheduler credential');
    }
    return this.service.runAllDueBilling(body.throughOn);
  }
}

@Public()
@Controller('v1/webhooks/payments')
export class PaymentWebhookController {
  constructor(private readonly service: FinanceService) {}

  @Post(':provider')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  ingest(
    @Param('provider') provider: string,
    @Headers('x-event-id') eventId: string,
    @Headers('x-bhd-signature') signature: string,
    @Req() request: FastifyRequest,
  ) {
    if (
      !/^[a-z0-9_-]{2,40}$/.test(provider) ||
      typeof eventId !== 'string' ||
      eventId.length < 1 ||
      eventId.length > 200 ||
      typeof signature !== 'string' ||
      signature.length > 500
    ) {
      throw new BadRequestException('Invalid webhook headers');
    }
    if (!request.rawBody) throw new Error('Raw webhook body is unavailable');
    return this.service.ingestWebhook(
      provider,
      eventId,
      signature,
      Buffer.isBuffer(request.rawBody) ? request.rawBody : Buffer.from(request.rawBody),
    );
  }
}
