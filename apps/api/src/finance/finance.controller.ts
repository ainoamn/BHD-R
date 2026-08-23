import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
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
});

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

  @RequirePermissions('payment.record')
  @Idempotent()
  @Post('payments')
  payment(
    @Req() request: FastifyRequest,
    @Body(new ZodPipe(recordPaymentSchema)) body: z.infer<typeof recordPaymentSchema>,
  ) {
    return this.service.recordPayment(request.auth!, body);
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
