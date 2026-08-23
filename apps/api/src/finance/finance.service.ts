import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { lookup } from 'node:dns/promises';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  invoiceLines,
  invoices,
  leases,
  organizations,
  outboxEvents,
  paymentGatewaySettings,
  payments,
  webhookEvents,
} from '@bhd-r/db';
import type { SessionClaims } from '@bhd-r/authz';
import { currencyMinorUnits, publicInvoiceSchema, type RecordPaymentInput } from '@bhd-r/contracts';
import { calculateInvoice } from '@bhd-r/domain';
import { assertSafeOutboundUrl, encryptField, type Keyring } from '@bhd-r/security';
import { DatabaseService, type DatabaseTransaction } from '../database/database.service.js';
import { z } from 'zod';

interface CreateInvoiceInput {
  leaseId: string;
  issuedOn: string;
  dueOn: string;
  lines: Array<{
    description: string;
    quantity: string;
    unitAmount: {
      amountMinor: string;
      currency: 'OMR' | 'AED' | 'SAR' | 'BHD' | 'KWD' | 'QAR' | 'USD';
    };
    taxRateBasisPoints?: number | undefined;
  }>;
  notes?: string | undefined;
}

function secretKeyring(purpose: string): Keyring {
  const entries = Object.entries(process.env).filter(
    ([key, value]) => /^FIELD_ENCRYPTION_KEY_V\d+$/.test(key) && value,
  );
  if (entries.length === 0)
    entries.push(['FIELD_ENCRYPTION_KEY_V1', 'development-field-key-change-in-production']);
  return {
    activeVersion: process.env.FIELD_ENCRYPTION_ACTIVE_VERSION ?? 'v1',
    keys: Object.fromEntries(
      entries.map(([name, value]) => [
        name.replace('FIELD_ENCRYPTION_KEY_', '').toLowerCase(),
        createHash('sha256')
          .update(`${value ?? ''}\0${purpose}`)
          .digest(),
      ]),
    ),
  };
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class FinanceService {
  constructor(private readonly database: DatabaseService) {}

  createInvoice(claims: SessionClaims, input: CreateInvoiceInput) {
    return this.database.withinTenant(claims, async (transaction) => {
      const lease = await transaction.query.leases.findFirst({
        where: and(eq(leases.id, input.leaseId), eq(leases.organizationId, claims.organizationId!)),
      });
      if (!lease) throw new NotFoundException('Lease not found');
      if (input.lines.some((line) => line.unitAmount.currency !== lease.currency))
        throw new ConflictException('Invoice currency must match the lease');
      const calculated = calculateInvoice(
        input.lines.map((line) => ({
          description: line.description,
          quantity: line.quantity,
          ...(line.taxRateBasisPoints !== undefined
            ? { taxRateBasisPoints: line.taxRateBasisPoints }
            : {}),
          unitAmount: {
            amountMinor: BigInt(line.unitAmount.amountMinor),
            currency: line.unitAmount.currency,
            minorUnit: currencyMinorUnits[line.unitAmount.currency],
          },
        })),
      );
      const year = Number(input.issuedOn.slice(0, 4));
      const sequence = await transaction.execute(sql<{ allocated: bigint }>`
        insert into invoice_sequences (organization_id, year, next_value)
        values (${claims.organizationId!}, ${year}, 2)
        on conflict (organization_id, year)
        do update set next_value = invoice_sequences.next_value + 1
        returning next_value - 1 as allocated
      `);
      const allocated = BigInt(String(sequence[0]!.allocated));
      const invoiceNumber = `INV-${year}-${allocated.toString().padStart(6, '0')}`;
      const rows = await transaction
        .insert(invoices)
        .values({
          organizationId: claims.organizationId!,
          leaseId: lease.id,
          tenantPartyId: lease.tenantPartyId,
          invoiceNumber,
          status: 'issued',
          currency: calculated.total.currency,
          minorUnit: calculated.total.minorUnit,
          subtotalMinor: calculated.subtotal.amountMinor,
          taxMinor: calculated.tax.amountMinor,
          totalMinor: calculated.total.amountMinor,
          issuedOn: input.issuedOn,
          dueOn: input.dueOn,
          notes: input.notes,
        })
        .returning();
      const invoice = rows[0]!;
      await transaction.insert(invoiceLines).values(
        calculated.lines.map((line) => ({
          organizationId: claims.organizationId!,
          invoiceId: invoice.id,
          description: line.description,
          quantity: line.quantity,
          unitAmountMinor: line.unitAmount.amountMinor,
          taxRateBasisPoints: line.taxRateBasisPoints ?? 0,
          subtotalMinor: line.subtotalMinor,
          taxMinor: line.taxMinor,
          totalMinor: line.totalMinor,
        })),
      );
      await transaction.insert(outboxEvents).values({
        organizationId: claims.organizationId!,
        topic: 'invoice.issued',
        aggregateType: 'invoice',
        aggregateId: invoice.id,
        payload: { invoiceNumber },
      });
      return this.serializeInvoice(invoice);
    });
  }

  listInvoices(claims: SessionClaims) {
    return this.database.withinTenant(claims, async (transaction) => {
      const rows = await transaction
        .select()
        .from(invoices)
        .where(eq(invoices.organizationId, claims.organizationId!));
      return rows.map((row) => this.serializeInvoice(row));
    });
  }

  recordPayment(claims: SessionClaims, input: RecordPaymentInput) {
    return this.database.withinTenant(claims, (transaction) =>
      this.recordPaymentInTransaction(transaction, claims.organizationId!, input),
    );
  }

  async createPublicLink(
    claims: SessionClaims,
    invoiceId: string,
  ): Promise<{ token: string; expiresAt: string }> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 7 * 86_400_000);
    await this.database.withinTenant(claims, async (transaction) => {
      const rows = await transaction
        .update(invoices)
        .set({
          publicTokenHash: hashToken(token),
          publicTokenExpiresAt: expiresAt,
          updatedAt: new Date(),
        })
        .where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, claims.organizationId!)))
        .returning({ id: invoices.id });
      if (rows.length === 0) throw new NotFoundException('Invoice not found');
    });
    return { token, expiresAt: expiresAt.toISOString() };
  }

  async getPublicInvoice(token: string) {
    const result = await this.database.asSystem(async (transaction) =>
      transaction
        .select({
          invoiceNumber: invoices.invoiceNumber,
          status: invoices.status,
          issuedOn: invoices.issuedOn,
          dueOn: invoices.dueOn,
          totalMinor: invoices.totalMinor,
          paidMinor: invoices.paidMinor,
          currency: invoices.currency,
          merchantName: organizations.displayNameEn,
          expiresAt: invoices.publicTokenExpiresAt,
        })
        .from(invoices)
        .innerJoin(organizations, eq(organizations.id, invoices.organizationId))
        .where(eq(invoices.publicTokenHash, hashToken(token)))
        .limit(1),
    );
    const invoice = result[0];
    if (!invoice?.expiresAt || invoice.expiresAt <= new Date())
      throw new NotFoundException('Invoice link is invalid or expired');
    return publicInvoiceSchema.parse({
      publicReference: invoice.invoiceNumber,
      status: invoice.status,
      issuedOn: invoice.issuedOn,
      dueOn: invoice.dueOn,
      total: { amountMinor: invoice.totalMinor.toString(), currency: invoice.currency },
      outstanding: {
        amountMinor: (invoice.totalMinor - invoice.paidMinor).toString(),
        currency: invoice.currency,
      },
      merchantName: invoice.merchantName,
      paymentEnabled: false,
    });
  }

  async configureGateway(
    claims: SessionClaims,
    input: { provider: string; endpoint: string; credentials: Record<string, string> },
  ) {
    const allowedHosts = (process.env.PAYMENT_GATEWAY_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean);
    const safeTarget = await assertSafeOutboundUrl(
      input.endpoint,
      async (hostname) =>
        (await lookup(hostname, { all: true, verbatim: true })).map((record) => record.address),
      allowedHosts,
    );
    const encrypted = encryptField(
      JSON.stringify({
        credentials: input.credentials,
        pinnedAddresses: safeTarget.resolvedAddresses,
      }),
      secretKeyring('payment-gateway'),
      `gateway:${claims.organizationId}:${input.provider}`,
    );
    return this.database.withinTenant(claims, async (transaction) => {
      const rows = await transaction
        .insert(paymentGatewaySettings)
        .values({
          organizationId: claims.organizationId!,
          provider: input.provider,
          endpoint: safeTarget.url.toString(),
          credentialsEncrypted: encrypted,
          encryptionVersion: secretKeyring('payment-gateway').activeVersion,
        })
        .onConflictDoUpdate({
          target: [paymentGatewaySettings.organizationId, paymentGatewaySettings.provider],
          set: {
            endpoint: safeTarget.url.toString(),
            credentialsEncrypted: encrypted,
            encryptionVersion: secretKeyring('payment-gateway').activeVersion,
            updatedAt: new Date(),
          },
        })
        .returning({
          id: paymentGatewaySettings.id,
          provider: paymentGatewaySettings.provider,
          endpoint: paymentGatewaySettings.endpoint,
          active: paymentGatewaySettings.active,
        });
      return rows[0];
    });
  }

  async ingestWebhook(
    provider: string,
    eventId: string,
    signature: string,
    rawBody: Buffer,
  ): Promise<{ duplicate: boolean }> {
    this.verifyWebhookSignature(signature, rawBody);
    const payloadHash = createHash('sha256').update(rawBody).digest('hex');
    const payload = JSON.parse(rawBody.toString('utf8')) as unknown;
    const parsed = this.parseWebhookPayload(payload);
    return this.database.asWebhookConsumer(async (transaction) => {
      const events = await transaction
        .insert(webhookEvents)
        .values({
          provider,
          providerEventId: eventId,
          organizationId: parsed.organizationId,
          payloadHash,
          signatureVerified: true,
        })
        .onConflictDoNothing()
        .returning();
      if (events.length === 0) {
        const existing = await transaction.query.webhookEvents.findFirst({
          where: and(
            eq(webhookEvents.provider, provider),
            eq(webhookEvents.providerEventId, eventId),
          ),
        });
        if (!existing || existing.payloadHash !== payloadHash)
          throw new ConflictException('Webhook event identifier collision');
        return { duplicate: true };
      }
      try {
        await this.recordPaymentInTransaction(transaction, parsed.organizationId, {
          invoiceId: parsed.invoiceId,
          amount: { amountMinor: parsed.amountMinor, currency: parsed.currency },
          provider,
          providerReference: parsed.providerReference,
          receivedAt: parsed.receivedAt,
          method: parsed.method,
        });
        await transaction
          .update(webhookEvents)
          .set({ status: 'processed', processedAt: new Date(), updatedAt: new Date() })
          .where(eq(webhookEvents.id, events[0]!.id));
        return { duplicate: false };
      } catch (error) {
        await transaction
          .update(webhookEvents)
          .set({
            status: 'failed',
            failureCode: error instanceof Error ? error.name : 'UNKNOWN',
            updatedAt: new Date(),
          })
          .where(eq(webhookEvents.id, events[0]!.id));
        throw error;
      }
    });
  }

  private async recordPaymentInTransaction(
    transaction: DatabaseTransaction,
    organizationId: string,
    input: RecordPaymentInput,
  ) {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${input.invoiceId}, 0))`,
    );
    const invoice = await transaction.query.invoices.findFirst({
      where: and(eq(invoices.id, input.invoiceId), eq(invoices.organizationId, organizationId)),
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (input.amount.currency !== invoice.currency)
      throw new ConflictException('Payment currency mismatch');
    const amountMinor = BigInt(input.amount.amountMinor);
    if (amountMinor <= 0n || invoice.paidMinor + amountMinor > invoice.totalMinor)
      throw new ConflictException('Payment exceeds outstanding balance');
    const rows = await transaction
      .insert(payments)
      .values({
        organizationId,
        invoiceId: invoice.id,
        status: 'succeeded',
        amountMinor,
        currency: input.amount.currency,
        minorUnit: currencyMinorUnits[input.amount.currency],
        provider: input.provider,
        providerReference: input.providerReference,
        receivedAt: new Date(input.receivedAt),
        method: input.method,
      })
      .onConflictDoNothing()
      .returning();
    if (rows.length === 0) {
      const existing = await transaction.query.payments.findFirst({
        where: and(
          eq(payments.provider, input.provider),
          eq(payments.providerReference, input.providerReference),
        ),
      });
      if (existing?.invoiceId !== invoice.id || existing.amountMinor !== amountMinor)
        throw new ConflictException('Provider reference collision');
      return { ...existing, amountMinor: existing.amountMinor.toString(), duplicate: true };
    }
    const paidMinor = invoice.paidMinor + amountMinor;
    await transaction
      .update(invoices)
      .set({
        paidMinor,
        status: paidMinor === invoice.totalMinor ? 'paid' : 'partially_paid',
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, invoice.id));
    await transaction.insert(outboxEvents).values({
      organizationId,
      topic: 'payment.recorded',
      aggregateType: 'payment',
      aggregateId: rows[0]!.id,
      payload: { invoiceId: invoice.id, amountMinor: amountMinor.toString() },
    });
    return {
      ...rows[0],
      amountMinor: rows[0]!.amountMinor.toString(),
      refundedMinor: rows[0]!.refundedMinor.toString(),
      duplicate: false,
    };
  }

  private verifyWebhookSignature(signatureHeader: string, body: Buffer): void {
    const parts = Object.fromEntries(
      signatureHeader.split(',').map((part) => part.split('=', 2) as [string, string]),
    );
    const timestamp = Number(parts.t);
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300 || !parts.v1)
      throw new UnauthorizedException('Webhook signature expired');
    const expected = createHmac(
      'sha256',
      process.env.PAYMENT_WEBHOOK_SECRET ?? 'development-webhook-secret',
    )
      .update(`${timestamp}.${body.toString('utf8')}`)
      .digest('hex');
    const actualBuffer = Buffer.from(parts.v1, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(actualBuffer, expectedBuffer)
    )
      throw new UnauthorizedException('Invalid webhook signature');
  }

  private parseWebhookPayload(value: unknown): {
    organizationId: string;
    invoiceId: string;
    amountMinor: string;
    currency: 'OMR' | 'AED' | 'SAR' | 'BHD' | 'KWD' | 'QAR' | 'USD';
    providerReference: string;
    receivedAt: string;
    method: 'bank_transfer' | 'card' | 'cash' | 'cheque' | 'other';
  } {
    return z
      .object({
        organizationId: z.uuid(),
        invoiceId: z.uuid(),
        amountMinor: z.string().regex(/^\d+$/),
        currency: z.enum(['OMR', 'AED', 'SAR', 'BHD', 'KWD', 'QAR', 'USD']),
        providerReference: z.string().min(1).max(200),
        receivedAt: z.iso.datetime(),
        method: z.enum(['bank_transfer', 'card', 'cash', 'cheque', 'other']),
      })
      .parse(value);
  }

  private serializeInvoice(invoice: typeof invoices.$inferSelect) {
    return {
      id: invoice.id,
      organizationId: invoice.organizationId,
      leaseId: invoice.leaseId,
      tenantPartyId: invoice.tenantPartyId,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      currency: invoice.currency,
      minorUnit: invoice.minorUnit,
      subtotalMinor: invoice.subtotalMinor.toString(),
      taxMinor: invoice.taxMinor.toString(),
      totalMinor: invoice.totalMinor.toString(),
      paidMinor: invoice.paidMinor.toString(),
      issuedOn: invoice.issuedOn,
      dueOn: invoice.dueOn,
      notes: invoice.notes,
      createdAt: invoice.createdAt,
      updatedAt: invoice.updatedAt,
    };
  }
}
