import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { and, asc, eq, inArray, lt, lte, sql } from 'drizzle-orm';
import { lookup } from 'node:dns/promises';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  invoiceLines,
  invoices,
  journalEntries,
  journalLines,
  ledgerAccounts,
  billingSchedules,
  cheques,
  holds,
  leases,
  organizations,
  outboxEvents,
  parties,
  paymentGatewaySettings,
  paymentSessions,
  payments,
  receipts,
  refunds,
  reservations,
  stayBookingStatusHistory,
  stayBookings,
  stayPaymentIntents,
  webhookEvents,
  workflowEvents,
} from '@bhd-r/db';
import { isPaymentSandboxPilotEnabled, resolveStaysEnabledFromEnv } from '@bhd-r/config';
import type { SessionClaims } from '@bhd-r/authz';
import {
  currencyMinorUnits,
  publicInvoiceSchema,
  type CurrencyCode,
  type RecordPaymentInput,
} from '@bhd-r/contracts';
import {
  assertStayBookingTransition,
  assertTransition,
  calculateInvoice,
  chequeMachine,
} from '@bhd-r/domain';
import { assertSafeOutboundUrl, encryptField, type Keyring } from '@bhd-r/security';
import { DatabaseService, type DatabaseTransaction } from '../database/database.service.js';
import { StaysInventoryService } from '../stays/stays-inventory.service.js';
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
  billingPeriodStart?: string | undefined;
  billingPeriodEnd?: string | undefined;
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

function sanitizeRelativeReturnPath(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (
    !/^\/(ar|en)(\/[A-Za-z0-9._~-]{1,64}){1,6}(\?[A-Za-z0-9._~=&%-]{0,200})?$/.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return isoDate(value);
}

function nextBillingDate(current: string, billingDay: number): string {
  const value = new Date(`${current}T00:00:00.000Z`);
  return isoDate(new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, billingDay)));
}

@Injectable()
export class FinanceService {
  readonly #s3 = new S3Client({
    region: process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
    ...(process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY
      ? {
          credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY,
            secretAccessKey: process.env.S3_SECRET_KEY,
          },
        }
      : {}),
  });

  constructor(
    private readonly database: DatabaseService,
    private readonly staysInventory: StaysInventoryService,
  ) {}

  createInvoice(claims: SessionClaims, input: CreateInvoiceInput) {
    return this.database.withinTenant(claims, (transaction) =>
      this.createInvoiceInTransaction(transaction, claims.organizationId!, input),
    );
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

  listBillingSchedules(claims: SessionClaims) {
    return this.database.withinTenant(claims, async (transaction) => {
      const rows = await transaction
        .select({
          id: billingSchedules.id,
          leaseId: billingSchedules.leaseId,
          status: billingSchedules.status,
          frequency: billingSchedules.frequency,
          billingDay: billingSchedules.billingDay,
          dueDays: billingSchedules.dueDays,
          taxRateBasisPoints: billingSchedules.taxRateBasisPoints,
          nextIssueOn: billingSchedules.nextIssueOn,
          lastIssuedOn: billingSchedules.lastIssuedOn,
          descriptionAr: billingSchedules.descriptionAr,
          descriptionEn: billingSchedules.descriptionEn,
        })
        .from(billingSchedules)
        .where(eq(billingSchedules.organizationId, claims.organizationId!))
        .orderBy(asc(billingSchedules.nextIssueOn));
      return rows;
    });
  }

  runDueBilling(claims: SessionClaims, throughOn = isoDate(new Date())) {
    return this.database.withinTenant(claims, (transaction) =>
      this.generateDueInvoices(transaction, claims.organizationId!, throughOn),
    );
  }

  runAllDueBilling(throughOn = isoDate(new Date())) {
    return this.database.asSystem(async (transaction) => {
      const organizationRows = await transaction
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.status, 'active'));
      const results = [];
      for (const organization of organizationRows) {
        results.push(await this.generateDueInvoices(transaction, organization.id, throughOn));
      }
      return {
        throughOn,
        organizations: results.length,
        invoicesCreated: results.reduce((sum, result) => sum + result.invoicesCreated, 0),
      };
    });
  }

  listPayments(claims: SessionClaims) {
    return this.database.withinTenant(claims, async (transaction) => {
      const rows = await transaction
        .select()
        .from(payments)
        .where(eq(payments.organizationId, claims.organizationId!));
      return rows.map((row) => ({
        ...row,
        amountMinor: row.amountMinor.toString(),
        refundedMinor: row.refundedMinor.toString(),
      }));
    });
  }

  listReceipts(claims: SessionClaims) {
    return this.database.withinTenant(claims, async (transaction) => {
      const rows = await transaction
        .select()
        .from(receipts)
        .where(eq(receipts.organizationId, claims.organizationId!))
        .orderBy(asc(receipts.issuedAt));
      return rows.map((row) => ({
        id: row.id,
        paymentId: row.paymentId,
        receiptNumber: row.receiptNumber,
        amountMinor: row.amountMinor.toString(),
        currency: row.currency,
        issuedAt: row.issuedAt,
        documentReady: Boolean(row.renderedPdfObjectKey && row.renderedPdfHash),
        documentHash: row.renderedPdfHash,
      }));
    });
  }

  async documentUrl(claims: SessionClaims, kind: 'invoice' | 'receipt', id: string) {
    const document = await this.database.withinTenant(claims, async (transaction) => {
      if (kind === 'invoice') {
        const row = await transaction.query.invoices.findFirst({
          where: and(eq(invoices.id, id), eq(invoices.organizationId, claims.organizationId!)),
        });
        return row
          ? {
              objectKey: row.renderedPdfObjectKey,
              hash: row.renderedPdfHash,
              filename: `${row.invoiceNumber}.pdf`,
            }
          : null;
      }
      const row = await transaction.query.receipts.findFirst({
        where: and(eq(receipts.id, id), eq(receipts.organizationId, claims.organizationId!)),
      });
      return row
        ? {
            objectKey: row.renderedPdfObjectKey,
            hash: row.renderedPdfHash,
            filename: `${row.receiptNumber}.pdf`,
          }
        : null;
    });
    if (!document) throw new NotFoundException('Document not found');
    if (!document.objectKey || !document.hash)
      throw new ConflictException('Document generation is still in progress');
    const expiresInSeconds = 180;
    const url = await getSignedUrl(
      this.#s3,
      new GetObjectCommand({
        Bucket: process.env.S3_BUCKET_PRIVATE ?? 'bhd-r-private',
        Key: document.objectKey,
        ResponseContentDisposition: `inline; filename="${document.filename}"`,
        ResponseContentType: 'application/pdf',
      }),
      { expiresIn: expiresInSeconds },
    );
    return { url, expiresInSeconds, sha256: document.hash };
  }

  listRefunds(claims: SessionClaims) {
    return this.database.withinTenant(claims, async (transaction) => {
      const rows = await transaction
        .select()
        .from(refunds)
        .where(eq(refunds.organizationId, claims.organizationId!))
        .orderBy(asc(refunds.createdAt));
      return rows.map((row) => ({ ...row, amountMinor: row.amountMinor.toString() }));
    });
  }

  recordRefund(
    claims: SessionClaims,
    paymentId: string,
    input: {
      amountMinor: string;
      providerReference: string;
      reason: string;
      completedAt?: string | undefined;
    },
  ) {
    return this.database.withinTenant(claims, async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${paymentId}, 19))`,
      );
      const payment = await transaction.query.payments.findFirst({
        where: and(eq(payments.id, paymentId), eq(payments.organizationId, claims.organizationId!)),
      });
      if (!payment) throw new NotFoundException('Payment not found');
      if (payment.status === 'failed' || payment.status === 'pending') {
        throw new ConflictException('Only a captured payment can be refunded');
      }
      const amountMinor = BigInt(input.amountMinor);
      if (amountMinor <= 0n || payment.refundedMinor + amountMinor > payment.amountMinor) {
        throw new ConflictException('Refund exceeds the refundable balance');
      }
      const refundRows = await transaction
        .insert(refunds)
        .values({
          organizationId: claims.organizationId!,
          paymentId: payment.id,
          requestedByUserId: claims.sub,
          amountMinor,
          currency: payment.currency,
          provider: payment.provider,
          providerReference: input.providerReference,
          status: 'succeeded',
          reason: input.reason,
          completedAt: input.completedAt ? new Date(input.completedAt) : new Date(),
        })
        .onConflictDoNothing()
        .returning();
      if (!refundRows[0]) {
        const existing = await transaction.query.refunds.findFirst({
          where: and(
            eq(refunds.provider, payment.provider),
            eq(refunds.providerReference, input.providerReference),
          ),
        });
        if (existing?.paymentId !== payment.id || existing.amountMinor !== amountMinor) {
          throw new ConflictException('Refund provider reference collision');
        }
        return { ...existing, amountMinor: existing.amountMinor.toString(), duplicate: true };
      }
      const refundedMinor = payment.refundedMinor + amountMinor;
      await transaction
        .update(payments)
        .set({
          refundedMinor,
          status: refundedMinor === payment.amountMinor ? 'refunded' : 'partially_refunded',
          updatedAt: new Date(),
        })
        .where(eq(payments.id, payment.id));
      const invoice = await transaction.query.invoices.findFirst({
        where: eq(invoices.id, payment.invoiceId),
      });
      if (!invoice || invoice.paidMinor < amountMinor) {
        throw new ConflictException('Invoice payment balance is inconsistent');
      }
      const paidMinor = invoice.paidMinor - amountMinor;
      await transaction
        .update(invoices)
        .set({
          paidMinor,
          status: paidMinor === 0n ? 'issued' : 'partially_paid',
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, invoice.id));
      const lease = await transaction.query.leases.findFirst({
        where: and(
          eq(leases.id, invoice.leaseId),
          eq(leases.organizationId, claims.organizationId!),
        ),
      });
      await this.postFinanceJournal(transaction, claims.organizationId!, {
        sourceType: 'payment_refund',
        sourceId: refundRows[0].id,
        occurredOn: isoDate(input.completedAt ? new Date(input.completedAt) : new Date()),
        description: `Refund ${refundRows[0].providerReference}`,
        partyId: invoice.tenantPartyId,
        unitId: lease?.unitId,
        currency: payment.currency as CurrencyCode,
        lines: [
          { accountCode: '1100', debitMinor: amountMinor, creditMinor: 0n },
          { accountCode: '1000', debitMinor: 0n, creditMinor: amountMinor },
        ],
      });
      await transaction.insert(outboxEvents).values({
        organizationId: claims.organizationId!,
        topic: 'payment.refunded',
        aggregateType: 'refund',
        aggregateId: refundRows[0].id,
        payload: {
          paymentId: payment.id,
          invoiceId: invoice.id,
          amountMinor: amountMinor.toString(),
        },
      });
      return { ...refundRows[0], amountMinor: amountMinor.toString(), duplicate: false };
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
    const publicView = await this.database.asSystem(async (transaction) => {
      const result = await transaction
        .select({
          id: invoices.id,
          organizationId: invoices.organizationId,
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
        .limit(1);
      const invoice = result[0];
      const gateway = invoice
        ? await transaction.query.paymentGatewaySettings.findFirst({
            where: and(
              eq(paymentGatewaySettings.organizationId, invoice.organizationId),
              eq(paymentGatewaySettings.active, true),
            ),
          })
        : null;
      return { invoice, gateway };
    });
    const invoice = publicView.invoice;
    if (!invoice?.expiresAt || invoice.expiresAt <= new Date())
      throw new NotFoundException('Invoice link is invalid or expired');
    const sandboxEnabled = isPaymentSandboxPilotEnabled();
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
      paymentEnabled:
        BigInt(invoice.totalMinor) > BigInt(invoice.paidMinor) &&
        (publicView.gateway?.provider === 'sandbox' || sandboxEnabled),
    });
  }

  async createPublicPaymentSession(
    token: string,
    idempotencyKey: string,
    locale: 'ar' | 'en',
    returnPath: string,
  ) {
    return this.database.asSystem(async (transaction) => {
      const invoice = await transaction.query.invoices.findFirst({
        where: and(
          eq(invoices.publicTokenHash, hashToken(token)),
          sql`${invoices.publicTokenExpiresAt} > now()`,
        ),
      });
      if (!invoice) throw new NotFoundException('Invoice link is invalid or expired');
      const outstandingMinor = invoice.totalMinor - invoice.paidMinor;
      if (outstandingMinor <= 0n) throw new ConflictException('Invoice is already paid');
      const existing = await transaction.query.paymentSessions.findFirst({
        where: and(
          eq(paymentSessions.organizationId, invoice.organizationId),
          eq(paymentSessions.idempotencyKey, idempotencyKey),
        ),
      });
      if (existing) {
        if (existing.invoiceId !== invoice.id || existing.amountMinor !== outstandingMinor) {
          throw new ConflictException('Payment session idempotency key was reused');
        }
        return {
          sessionReference: existing.sessionReference,
          redirectUrl: existing.redirectUrl,
          expiresAt: existing.expiresAt.toISOString(),
          duplicate: true,
        };
      }
      const configured = await transaction.query.paymentGatewaySettings.findFirst({
        where: and(
          eq(paymentGatewaySettings.organizationId, invoice.organizationId),
          eq(paymentGatewaySettings.active, true),
        ),
      });
      const sandboxEnabled = isPaymentSandboxPilotEnabled();
      const provider = configured?.provider ?? (sandboxEnabled ? 'sandbox' : null);
      if (provider !== 'sandbox') {
        throw new ConflictException('No supported online payment adapter is active');
      }
      const sessionReference = randomBytes(24).toString('base64url');
      const expiresAt = new Date(Date.now() + 20 * 60_000);
      const origin = (process.env.WEB_ORIGIN ?? 'http://localhost:3000').replace(/\/$/, '');
      const redirectUrl = `${origin}/${locale}/payments/sandbox/${sessionReference}`;
      await transaction.insert(paymentSessions).values({
        organizationId: invoice.organizationId,
        invoiceId: invoice.id,
        provider,
        sessionReference,
        idempotencyKey,
        amountMinor: outstandingMinor,
        currency: invoice.currency,
        redirectUrl,
        expiresAt,
        metadata: { returnPath },
      });
      return {
        sessionReference,
        redirectUrl,
        expiresAt: expiresAt.toISOString(),
        duplicate: false,
      };
    });
  }

  /**
   * Provider-hosted (sandbox) redirect for stay payment intents.
   * Session reference is stored on stay_payment_intents.provider_intent_id (Expand–Contract;
   * does not alter invoice payment_sessions).
   */
  async createStayPaymentSession(
    paymentIntentId: string,
    idempotencyKey: string,
    locale: 'ar' | 'en',
    returnPath: string,
  ) {
    return this.database.asPublic(async (transaction) => {
      const intent = await transaction.query.stayPaymentIntents.findFirst({
        where: eq(stayPaymentIntents.id, paymentIntentId),
      });
      if (!intent) throw new NotFoundException('Stay payment intent not found');

      const staysGate = resolveStaysEnabledFromEnv({
        organizationId: intent.organizationId,
        propertyEnabled: true,
        unitEnabled: true,
      });
      if (!staysGate.enabled) throw new NotFoundException();

      const booking = await transaction.query.stayBookings.findFirst({
        where: and(
          eq(stayBookings.id, intent.bookingId),
          eq(stayBookings.organizationId, intent.organizationId),
        ),
      });
      if (!booking) throw new NotFoundException('Stay booking not found');
      if (booking.status !== 'payment_pending') {
        throw new ConflictException(
          `Stay booking cannot start payment in status ${booking.status}`,
        );
      }
      if (intent.status === 'succeeded') {
        throw new ConflictException('Stay payment intent is already paid');
      }
      if (intent.status !== 'pending') {
        throw new ConflictException(`Stay payment intent status ${intent.status} is not payable`);
      }

      const configured = await transaction.query.paymentGatewaySettings.findFirst({
        where: and(
          eq(paymentGatewaySettings.organizationId, intent.organizationId),
          eq(paymentGatewaySettings.active, true),
        ),
      });
      const sandboxEnabled = isPaymentSandboxPilotEnabled();
      const provider = configured?.provider ?? (sandboxEnabled ? 'sandbox' : null);
      if (provider !== 'sandbox') {
        throw new ConflictException('No supported online payment adapter is active');
      }

      const origin = (process.env.WEB_ORIGIN ?? 'http://localhost:3000').replace(/\/$/, '');
      let sessionReference = intent.providerIntentId;
      if (
        intent.provider === 'sandbox' &&
        sessionReference &&
        /^[A-Za-z0-9_-]{24,80}$/.test(sessionReference)
      ) {
        const redirectUrl = `${origin}/${locale}/payments/sandbox/${sessionReference}?kind=stay&return=${encodeURIComponent(returnPath)}`;
        return {
          sessionReference,
          redirectUrl,
          paymentIntentId: intent.id,
          amountMinor: intent.amountMinor.toString(),
          currency: intent.currency,
          duplicate: true as const,
          idempotencyKey,
        };
      }

      sessionReference = randomBytes(24).toString('base64url');
      await transaction
        .update(stayPaymentIntents)
        .set({
          provider: 'sandbox',
          providerIntentId: sessionReference,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(stayPaymentIntents.id, intent.id),
            eq(stayPaymentIntents.organizationId, intent.organizationId),
            eq(stayPaymentIntents.status, 'pending'),
          ),
        );

      const redirectUrl = `${origin}/${locale}/payments/sandbox/${sessionReference}?kind=stay&return=${encodeURIComponent(returnPath)}`;
      return {
        sessionReference,
        redirectUrl,
        paymentIntentId: intent.id,
        amountMinor: intent.amountMinor.toString(),
        currency: intent.currency,
        duplicate: false as const,
        idempotencyKey,
      };
    });
  }

  completeSandboxPayment(sessionReference: string, returnPath?: string | null) {
    if (!isPaymentSandboxPilotEnabled()) {
      throw new NotFoundException('Sandbox payments are disabled');
    }
    const safeReturn = sanitizeRelativeReturnPath(returnPath);
    return this.database.asSystem(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${sessionReference}, 23))`,
      );
      const session = await transaction.query.paymentSessions.findFirst({
        where: and(
          eq(paymentSessions.sessionReference, sessionReference),
          eq(paymentSessions.provider, 'sandbox'),
        ),
      });
      if (session) {
        if (session.status === 'completed') {
          return {
            completed: true,
            duplicate: true,
            kind: 'invoice' as const,
            invoiceId: session.invoiceId,
            returnPath:
              safeReturn ??
              (typeof session.metadata === 'object' &&
              session.metadata !== null &&
              'returnPath' in session.metadata
                ? String((session.metadata as Record<string, unknown>).returnPath)
                : null),
          };
        }
        if (session.expiresAt <= new Date()) {
          await transaction
            .update(paymentSessions)
            .set({ status: 'expired', updatedAt: new Date() })
            .where(eq(paymentSessions.id, session.id));
          throw new ConflictException('Payment session expired');
        }
        if (!(session.currency in currencyMinorUnits)) {
          throw new ConflictException('Payment session currency is unsupported');
        }
        const currency = session.currency as CurrencyCode;
        const payment = await this.recordPaymentInTransaction(transaction, session.organizationId, {
          invoiceId: session.invoiceId,
          amount: { amountMinor: session.amountMinor.toString(), currency },
          provider: 'sandbox',
          providerReference: `sandbox:${session.sessionReference}`,
          receivedAt: new Date().toISOString(),
          method: 'card',
        });
        await transaction
          .update(paymentSessions)
          .set({ status: 'completed', updatedAt: new Date() })
          .where(eq(paymentSessions.id, session.id));
        return {
          completed: true,
          duplicate: false,
          kind: 'invoice' as const,
          invoiceId: session.invoiceId,
          returnPath:
            safeReturn ??
            (typeof session.metadata === 'object' &&
            session.metadata !== null &&
            'returnPath' in session.metadata
              ? String((session.metadata as Record<string, unknown>).returnPath)
              : null),
          payment,
        };
      }

      const intent = await transaction.query.stayPaymentIntents.findFirst({
        where: and(
          eq(stayPaymentIntents.providerIntentId, sessionReference),
          eq(stayPaymentIntents.provider, 'sandbox'),
        ),
      });
      if (!intent) throw new NotFoundException('Payment session not found');

      if (intent.status === 'succeeded') {
        return {
          completed: true,
          duplicate: true,
          kind: 'stay_booking' as const,
          paymentIntentId: intent.id,
          returnPath: safeReturn,
        };
      }

      if (!(intent.currency in currencyMinorUnits)) {
        throw new ConflictException('Stay payment currency is unsupported');
      }

      await this.confirmStayBookingFromWebhook(transaction, {
        organizationId: intent.organizationId,
        paymentIntentId: intent.id,
        amountMinor: intent.amountMinor.toString(),
        currency: intent.currency as CurrencyCode,
        provider: 'sandbox',
        providerReference: `sandbox:${sessionReference}`,
        receivedAt: new Date().toISOString(),
        method: 'card',
        providerEventId: `sandbox-stay:${sessionReference}`,
      });

      return {
        completed: true,
        duplicate: false,
        kind: 'stay_booking' as const,
        paymentIntentId: intent.id,
        returnPath: safeReturn,
      };
    });
  }

  async configureGateway(
    claims: SessionClaims,
    input: {
      provider: string;
      endpoint: string;
      credentials: Record<string, string>;
      active: boolean;
    },
  ) {
    const allowedHosts = (process.env.PAYMENT_GATEWAY_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean);
    const sandbox = input.provider === 'sandbox';
    if (sandbox && !isPaymentSandboxPilotEnabled()) {
      throw new ConflictException('Sandbox gateway is disabled');
    }
    const safeTarget = sandbox
      ? {
          url: new URL((process.env.WEB_ORIGIN ?? 'http://localhost:3000').replace(/\/$/, '')),
          resolvedAddresses: [] as string[],
        }
      : await assertSafeOutboundUrl(
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
      if (input.active) {
        await transaction
          .update(paymentGatewaySettings)
          .set({ active: false, updatedAt: new Date() })
          .where(eq(paymentGatewaySettings.organizationId, claims.organizationId!));
      }
      const rows = await transaction
        .insert(paymentGatewaySettings)
        .values({
          organizationId: claims.organizationId!,
          provider: input.provider,
          endpoint: safeTarget.url.toString(),
          credentialsEncrypted: encrypted,
          encryptionVersion: secretKeyring('payment-gateway').activeVersion,
          active: input.active,
        })
        .onConflictDoUpdate({
          target: [paymentGatewaySettings.organizationId, paymentGatewaySettings.provider],
          set: {
            endpoint: safeTarget.url.toString(),
            credentialsEncrypted: encrypted,
            encryptionVersion: secretKeyring('payment-gateway').activeVersion,
            active: input.active,
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
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as unknown;
    } catch {
      throw new BadRequestException('Webhook body must be JSON');
    }
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
        if (parsed.kind === 'reservation_deposit') {
          await this.confirmPublicReservationDepositFromWebhook(transaction, {
            organizationId: parsed.organizationId,
            checkoutSessionReference: parsed.checkoutSessionReference,
            amountMinor: parsed.amountMinor,
            currency: parsed.currency,
            provider,
            providerReference: parsed.providerReference,
            receivedAt: parsed.receivedAt,
            method: parsed.method,
          });
        } else if (parsed.kind === 'stay_booking') {
          await this.confirmStayBookingFromWebhook(transaction, {
            organizationId: parsed.organizationId,
            paymentIntentId: parsed.paymentIntentId,
            amountMinor: parsed.amountMinor,
            currency: parsed.currency,
            provider,
            providerReference: parsed.providerReference,
            receivedAt: parsed.receivedAt,
            method: parsed.method,
            providerEventId: eventId,
          });
        } else {
          await this.recordPaymentInTransaction(transaction, parsed.organizationId, {
            invoiceId: parsed.invoiceId,
            amount: { amountMinor: parsed.amountMinor, currency: parsed.currency },
            provider,
            providerReference: parsed.providerReference,
            receivedAt: parsed.receivedAt,
            method: parsed.method,
          });
        }
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

  private async createInvoiceInTransaction(
    transaction: DatabaseTransaction,
    organizationId: string,
    input: CreateInvoiceInput,
  ) {
    const lease = await transaction.query.leases.findFirst({
      where: and(eq(leases.id, input.leaseId), eq(leases.organizationId, organizationId)),
    });
    if (!lease) throw new NotFoundException('Lease not found');
    if (input.lines.some((line) => line.unitAmount.currency !== lease.currency)) {
      throw new ConflictException('Invoice currency must match the lease');
    }
    if (input.billingPeriodStart) {
      const existing = await transaction.query.invoices.findFirst({
        where: and(
          eq(invoices.organizationId, organizationId),
          eq(invoices.leaseId, lease.id),
          eq(invoices.billingPeriodStart, input.billingPeriodStart),
        ),
      });
      if (existing) return { ...this.serializeInvoice(existing), duplicate: true };
    }
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
      values (${organizationId}, ${year}, 2)
      on conflict (organization_id, year)
      do update set next_value = invoice_sequences.next_value + 1
      returning next_value - 1 as allocated
    `);
    const allocated = BigInt(String(sequence[0]!.allocated));
    const invoiceNumber = `INV-${year}-${allocated.toString().padStart(6, '0')}`;
    const rows = await transaction
      .insert(invoices)
      .values({
        organizationId,
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
        billingPeriodStart: input.billingPeriodStart,
        billingPeriodEnd: input.billingPeriodEnd,
        notes: input.notes,
      })
      .returning();
    const invoice = rows[0]!;
    await transaction.insert(invoiceLines).values(
      calculated.lines.map((line) => ({
        organizationId,
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
    await this.postFinanceJournal(transaction, organizationId, {
      sourceType: 'invoice_issue',
      sourceId: invoice.id,
      occurredOn: input.issuedOn,
      description: `Invoice ${invoiceNumber}`,
      partyId: lease.tenantPartyId,
      unitId: lease.unitId,
      currency: input.lines[0]!.unitAmount.currency,
      lines: [
        {
          accountCode: '1100',
          debitMinor: calculated.total.amountMinor,
          creditMinor: 0n,
        },
        {
          accountCode: '4000',
          debitMinor: 0n,
          creditMinor: calculated.subtotal.amountMinor,
        },
        ...(calculated.tax.amountMinor > 0n
          ? [
              {
                accountCode: '2200' as const,
                debitMinor: 0n,
                creditMinor: calculated.tax.amountMinor,
              },
            ]
          : []),
      ],
    });
    await transaction.insert(outboxEvents).values({
      organizationId,
      topic: 'invoice.issued',
      aggregateType: 'invoice',
      aggregateId: invoice.id,
      payload: { invoiceNumber, billingPeriodStart: input.billingPeriodStart ?? null },
    });
    return { ...this.serializeInvoice(invoice), duplicate: false };
  }

  private async generateDueInvoices(
    transaction: DatabaseTransaction,
    organizationId: string,
    throughOn: string,
  ): Promise<{ organizationId: string; invoicesCreated: number; scheduleCount: number }> {
    await transaction
      .update(invoices)
      .set({ status: 'overdue', updatedAt: new Date() })
      .where(
        and(
          eq(invoices.organizationId, organizationId),
          inArray(invoices.status, ['issued', 'partially_paid']),
          lt(invoices.dueOn, throughOn),
        ),
      );
    const schedules = await transaction
      .select()
      .from(billingSchedules)
      .where(
        and(
          eq(billingSchedules.organizationId, organizationId),
          eq(billingSchedules.status, 'active'),
          lte(billingSchedules.nextIssueOn, throughOn),
        ),
      )
      .orderBy(asc(billingSchedules.nextIssueOn));
    let invoicesCreated = 0;
    for (const schedule of schedules) {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${schedule.id}, 29))`,
      );
      const lease = await transaction.query.leases.findFirst({
        where: and(eq(leases.id, schedule.leaseId), eq(leases.organizationId, organizationId)),
      });
      if (!lease || lease.status !== 'active') {
        await transaction
          .update(billingSchedules)
          .set({
            status: lease?.status === 'ended' ? 'completed' : 'paused',
            updatedAt: new Date(),
          })
          .where(eq(billingSchedules.id, schedule.id));
        continue;
      }
      if (!(lease.currency in currencyMinorUnits)) {
        throw new ConflictException(`Unsupported lease currency: ${lease.currency}`);
      }
      const leaseCurrency = lease.currency as CurrencyCode;
      let nextIssueOn = schedule.nextIssueOn;
      let generatedForSchedule = 0;
      while (nextIssueOn <= throughOn && generatedForSchedule < 24) {
        if (nextIssueOn > lease.endsOn) {
          await transaction
            .update(billingSchedules)
            .set({ status: 'completed', updatedAt: new Date() })
            .where(eq(billingSchedules.id, schedule.id));
          break;
        }
        const nextPeriodStart = nextBillingDate(nextIssueOn, schedule.billingDay);
        const invoice = await this.createInvoiceInTransaction(transaction, organizationId, {
          leaseId: lease.id,
          issuedOn: nextIssueOn,
          dueOn: addDays(nextIssueOn, schedule.dueDays),
          billingPeriodStart: nextIssueOn,
          billingPeriodEnd: addDays(nextPeriodStart, -1),
          lines: [
            {
              description: schedule.descriptionAr,
              quantity: '1',
              unitAmount: {
                amountMinor: lease.rentMinor.toString(),
                currency: leaseCurrency,
              },
              taxRateBasisPoints: schedule.taxRateBasisPoints,
            },
          ],
        });
        if (!invoice.duplicate) invoicesCreated += 1;
        await transaction
          .update(billingSchedules)
          .set({
            lastIssuedOn: nextIssueOn,
            nextIssueOn: nextPeriodStart,
            updatedAt: new Date(),
          })
          .where(eq(billingSchedules.id, schedule.id));
        nextIssueOn = nextPeriodStart;
        generatedForSchedule += 1;
      }
    }
    return { organizationId, invoicesCreated, scheduleCount: schedules.length };
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
      const receipt = existing
        ? await transaction.query.receipts.findFirst({ where: eq(receipts.paymentId, existing.id) })
        : null;
      return {
        ...existing,
        amountMinor: existing.amountMinor.toString(),
        duplicate: true,
        receipt: receipt ? { ...receipt, amountMinor: receipt.amountMinor.toString() } : null,
      };
    }
    const receiptYear = new Date(input.receivedAt).getUTCFullYear();
    const receiptSequence = await transaction.execute(sql<{ allocated: bigint }>`
      insert into receipt_sequences (organization_id, year, next_value)
      values (${organizationId}, ${receiptYear}, 2)
      on conflict (organization_id, year)
      do update set next_value = receipt_sequences.next_value + 1
      returning next_value - 1 as allocated
    `);
    const receiptNumber = `RCT-${receiptYear}-${BigInt(String(receiptSequence[0]!.allocated))
      .toString()
      .padStart(6, '0')}`;
    const receiptRows = await transaction
      .insert(receipts)
      .values({
        organizationId,
        paymentId: rows[0]!.id,
        receiptNumber,
        amountMinor,
        currency: input.amount.currency,
        issuedAt: new Date(input.receivedAt),
      })
      .returning();
    const paidMinor = invoice.paidMinor + amountMinor;
    await transaction
      .update(invoices)
      .set({
        paidMinor,
        status: paidMinor === invoice.totalMinor ? 'paid' : 'partially_paid',
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, invoice.id));
    const lease = await transaction.query.leases.findFirst({
      where: and(eq(leases.id, invoice.leaseId), eq(leases.organizationId, organizationId)),
    });
    await this.postFinanceJournal(transaction, organizationId, {
      sourceType: 'payment_receipt',
      sourceId: rows[0]!.id,
      occurredOn: isoDate(new Date(input.receivedAt)),
      description: `Payment ${input.providerReference}`,
      partyId: invoice.tenantPartyId,
      unitId: lease?.unitId,
      currency: input.amount.currency,
      lines: [
        { accountCode: '1000', debitMinor: amountMinor, creditMinor: 0n },
        { accountCode: '1100', debitMinor: 0n, creditMinor: amountMinor },
      ],
    });
    await transaction.insert(outboxEvents).values({
      organizationId,
      topic: 'payment.recorded',
      aggregateType: 'payment',
      aggregateId: rows[0]!.id,
      payload: { invoiceId: invoice.id, amountMinor: amountMinor.toString() },
    });
    await transaction.insert(outboxEvents).values({
      organizationId,
      topic: 'receipt.issued',
      aggregateType: 'receipt',
      aggregateId: receiptRows[0]!.id,
      payload: { invoiceId: invoice.id, paymentId: rows[0]!.id, receiptNumber },
    });
    return {
      ...rows[0],
      amountMinor: rows[0]!.amountMinor.toString(),
      refundedMinor: rows[0]!.refundedMinor.toString(),
      duplicate: false,
      receipt: { ...receiptRows[0]!, amountMinor: receiptRows[0]!.amountMinor.toString() },
    };
  }

  async postReservationDepositJournal(
    transaction: DatabaseTransaction,
    organizationId: string,
    input: {
      reservationId: string;
      partyId: string;
      unitId?: string | undefined;
      currency: CurrencyCode;
      depositMinor: bigint;
      occurredOn: string;
    },
  ) {
    if (input.depositMinor <= 0n) return null;
    return this.postFinanceJournal(transaction, organizationId, {
      sourceType: 'reservation_deposit',
      sourceId: input.reservationId,
      occurredOn: input.occurredOn,
      description: `Security deposit confirmed for reservation ${input.reservationId}`,
      partyId: input.partyId,
      unitId: input.unitId,
      currency: input.currency,
      lines: [
        { accountCode: '1000', debitMinor: input.depositMinor, creditMinor: 0n },
        { accountCode: '2100', debitMinor: 0n, creditMinor: input.depositMinor },
      ],
    });
  }

  private async postFinanceJournal(
    transaction: DatabaseTransaction,
    organizationId: string,
    input: {
      sourceType:
        | 'invoice_issue'
        | 'payment_receipt'
        | 'payment_refund'
        | 'reservation_deposit'
        | 'stay_payment';
      sourceId: string;
      occurredOn: string;
      description: string;
      partyId?: string | null;
      unitId?: string | undefined;
      currency: CurrencyCode;
      lines: Array<{
        accountCode: '1000' | '1100' | '2100' | '2200' | '4000';
        debitMinor: bigint;
        creditMinor: bigint;
      }>;
    },
  ) {
    const existing = await transaction.query.journalEntries.findFirst({
      where: and(
        eq(journalEntries.organizationId, organizationId),
        eq(journalEntries.sourceType, input.sourceType),
        eq(journalEntries.sourceId, input.sourceId),
      ),
    });
    if (existing) return existing;
    const defaults = [
      { code: '1000', nameAr: 'النقد والبنوك', nameEn: 'Cash and banks', type: 'asset' as const },
      {
        code: '1100',
        nameAr: 'ذمم المستأجرين',
        nameEn: 'Tenant receivables',
        type: 'asset' as const,
      },
      {
        code: '2100',
        nameAr: 'تأمينات المستأجرين',
        nameEn: 'Tenant deposits',
        type: 'liability' as const,
      },
      {
        code: '2200',
        nameAr: 'ضريبة القيمة المضافة',
        nameEn: 'VAT payable',
        type: 'liability' as const,
      },
      {
        code: '4000',
        nameAr: 'إيرادات الإيجار',
        nameEn: 'Rental income',
        type: 'revenue' as const,
      },
    ];
    await transaction
      .insert(ledgerAccounts)
      .values(defaults.map((account) => ({ organizationId, ...account, system: true })))
      .onConflictDoNothing({ target: [ledgerAccounts.organizationId, ledgerAccounts.code] });
    const accountRows = await transaction
      .select({ id: ledgerAccounts.id, code: ledgerAccounts.code })
      .from(ledgerAccounts)
      .where(
        and(
          eq(ledgerAccounts.organizationId, organizationId),
          inArray(ledgerAccounts.code, [...new Set(input.lines.map((line) => line.accountCode))]),
        ),
      );
    const accounts = new Map(accountRows.map((account) => [account.code, account.id]));
    if (accounts.size !== new Set(input.lines.map((line) => line.accountCode)).size) {
      throw new ConflictException('Required system ledger accounts are unavailable');
    }
    const year = Number(input.occurredOn.slice(0, 4));
    const sequence = await transaction.execute(sql<{ allocated: bigint }>`
      insert into journal_sequences (organization_id, year, kind, next_value)
      values (${organizationId}, ${year}, 'JRN', 2)
      on conflict (organization_id, year, kind)
      do update set next_value = journal_sequences.next_value + 1
      returning next_value - 1 as allocated
    `);
    const reference = `JRN-${year}-${BigInt(String(sequence[0]!.allocated))
      .toString()
      .padStart(6, '0')}`;
    const entries = await transaction
      .insert(journalEntries)
      .values({
        organizationId,
        reference,
        occurredOn: input.occurredOn,
        description: input.description,
        status: 'posted',
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        postedAt: new Date(),
      })
      .returning();
    const entry = entries[0]!;
    await transaction.insert(journalLines).values(
      input.lines.map((line) => ({
        organizationId,
        journalEntryId: entry.id,
        accountId: accounts.get(line.accountCode)!,
        partyId: input.partyId ?? null,
        unitId: input.unitId,
        debitMinor: line.debitMinor,
        creditMinor: line.creditMinor,
        currency: input.currency,
        minorUnit: currencyMinorUnits[input.currency],
        memo: input.description,
      })),
    );
    await transaction.insert(outboxEvents).values({
      organizationId,
      topic: 'accounting.journal-posted',
      aggregateType: 'journal_entry',
      aggregateId: entry.id,
      payload: { reference, sourceType: input.sourceType, sourceId: input.sourceId },
    });
    return entry;
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

  private parseWebhookPayload(value: unknown):
    | {
        kind: 'invoice';
        organizationId: string;
        invoiceId: string;
        amountMinor: string;
        currency: 'OMR' | 'AED' | 'SAR' | 'BHD' | 'KWD' | 'QAR' | 'USD';
        providerReference: string;
        receivedAt: string;
        method: 'bank_transfer' | 'card' | 'cash' | 'cheque' | 'other';
      }
    | {
        kind: 'reservation_deposit';
        organizationId: string;
        checkoutSessionReference: string;
        amountMinor: string;
        currency: 'OMR' | 'AED' | 'SAR' | 'BHD' | 'KWD' | 'QAR' | 'USD';
        providerReference: string;
        receivedAt: string;
        method: 'bank_transfer' | 'card' | 'cash' | 'cheque' | 'other';
      }
    | {
        kind: 'stay_booking';
        organizationId: string;
        paymentIntentId: string;
        amountMinor: string;
        currency: 'OMR' | 'AED' | 'SAR' | 'BHD' | 'KWD' | 'QAR' | 'USD';
        providerReference: string;
        receivedAt: string;
        method: 'bank_transfer' | 'card' | 'cash' | 'cheque' | 'other';
      } {
    const moneyFields = {
      organizationId: z.uuid(),
      amountMinor: z.string().regex(/^\d+$/),
      currency: z.enum(['OMR', 'AED', 'SAR', 'BHD', 'KWD', 'QAR', 'USD']),
      providerReference: z.string().min(1).max(200),
      receivedAt: z.iso.datetime(),
      method: z.enum(['bank_transfer', 'card', 'cash', 'cheque', 'other']),
    };
    const reservationSchema = z
      .object({
        kind: z.literal('reservation_deposit'),
        checkoutSessionReference: z.string().trim().min(8).max(200),
        ...moneyFields,
      })
      .strict();
    const stayBookingSchema = z
      .object({
        kind: z.literal('stay_booking'),
        paymentIntentId: z.uuid(),
        ...moneyFields,
      })
      .strict();
    const invoiceSchema = z
      .object({
        kind: z.literal('invoice').optional(),
        invoiceId: z.uuid(),
        ...moneyFields,
      })
      .strict();

    try {
      if (value && typeof value === 'object') {
        const kind = (value as { kind?: unknown }).kind;
        if (kind === 'reservation_deposit') {
          const parsed = reservationSchema.parse(value);
          return { ...parsed, kind: 'reservation_deposit' };
        }
        if (kind === 'stay_booking') {
          const parsed = stayBookingSchema.parse(value);
          return { ...parsed, kind: 'stay_booking' };
        }
      }
      const parsed = invoiceSchema.parse(value);
      return { ...parsed, kind: 'invoice' };
    } catch {
      throw new BadRequestException('Invalid webhook payload');
    }
  }

  private async confirmStayBookingFromWebhook(
    transaction: DatabaseTransaction,
    input: {
      organizationId: string;
      paymentIntentId: string;
      amountMinor: string;
      currency: CurrencyCode;
      provider: string;
      providerReference: string;
      receivedAt: string;
      method: string;
      providerEventId: string;
    },
  ) {
    const intent = await transaction.query.stayPaymentIntents.findFirst({
      where: and(
        eq(stayPaymentIntents.id, input.paymentIntentId),
        eq(stayPaymentIntents.organizationId, input.organizationId),
      ),
    });
    if (!intent) throw new NotFoundException('Stay payment intent not found');

    if (intent.amountMinor.toString() !== input.amountMinor) {
      throw new ConflictException('Webhook amount does not match stay payment intent');
    }
    if (intent.currency !== input.currency) {
      throw new ConflictException('Webhook currency does not match stay payment intent');
    }

    const booking = await transaction.query.stayBookings.findFirst({
      where: and(
        eq(stayBookings.id, intent.bookingId),
        eq(stayBookings.organizationId, input.organizationId),
      ),
    });
    if (!booking) throw new NotFoundException('Stay booking not found');

    if (intent.status === 'succeeded' && booking.status === 'confirmed') {
      return;
    }

    if (booking.status !== 'payment_pending') {
      throw new ConflictException(`Stay booking cannot accept payment in status ${booking.status}`);
    }
    const transition = assertStayBookingTransition(booking.status, 'confirmed');
    if (!transition.ok) {
      throw new ConflictException(transition.reason ?? 'Illegal stay booking transition');
    }

    const amountMinor = BigInt(input.amountMinor);
    const journal = await this.postFinanceJournal(transaction, input.organizationId, {
      sourceType: 'stay_payment',
      sourceId: intent.id,
      occurredOn: input.receivedAt.slice(0, 10),
      description: `Stay booking payment confirmed for ${booking.referenceCode}`,
      partyId: booking.guestPartyId,
      unitId: booking.unitId,
      currency: input.currency,
      lines: [
        { accountCode: '1000', debitMinor: amountMinor, creditMinor: 0n },
        { accountCode: '4000', debitMinor: 0n, creditMinor: amountMinor },
      ],
    });

    await transaction
      .update(stayPaymentIntents)
      .set({
        status: 'succeeded',
        provider: input.provider,
        providerIntentId: input.providerReference,
        providerEventId: input.providerEventId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(stayPaymentIntents.id, intent.id),
          eq(stayPaymentIntents.organizationId, input.organizationId),
        ),
      );

    await this.staysInventory.convertHoldLockToBookingInTransaction(transaction, {
      organizationId: input.organizationId,
      lockId: booking.inventoryLockId,
      bookingId: booking.id,
      holdId: booking.holdId,
    });

    await transaction
      .update(stayBookings)
      .set({ status: 'confirmed', updatedAt: new Date() })
      .where(
        and(eq(stayBookings.id, booking.id), eq(stayBookings.organizationId, input.organizationId)),
      );

    await transaction.insert(stayBookingStatusHistory).values({
      organizationId: input.organizationId,
      bookingId: booking.id,
      fromStatus: 'payment_pending',
      toStatus: 'confirmed',
      reason: `Webhook ${input.provider}:${input.providerReference}`,
      metadataJson: {
        paymentIntentId: intent.id,
        journalEntryId: journal?.id ?? null,
      },
    });

    await transaction.insert(workflowEvents).values({
      organizationId: input.organizationId,
      actorUserId: null,
      resourceType: 'stay_booking',
      resourceId: booking.id,
      eventType: 'stay_booking.payment_confirmed',
      fromStatus: 'payment_pending',
      toStatus: 'confirmed',
      note: `Webhook ${input.provider}:${input.providerReference}`,
    });

    await transaction.insert(outboxEvents).values({
      organizationId: input.organizationId,
      topic: 'stay_booking.payment_confirmed',
      aggregateType: 'stay_booking',
      aggregateId: booking.id,
      payload: {
        paymentIntentId: intent.id,
        provider: input.provider,
        providerReference: input.providerReference,
        amountMinor: input.amountMinor,
        currency: input.currency,
        unitId: booking.unitId,
      },
    });
  }

  private async confirmPublicReservationDepositFromWebhook(
    transaction: DatabaseTransaction,
    input: {
      organizationId: string;
      checkoutSessionReference: string;
      amountMinor: string;
      currency: CurrencyCode;
      provider: string;
      providerReference: string;
      receivedAt: string;
      method: string;
    },
  ) {
    const found = await transaction.execute(sql`
      select
        id,
        unit_id,
        tenant_party_id,
        status,
        currency,
        terms_snapshot
      from reservations
      where organization_id = ${input.organizationId}::uuid
        and status in ('pending', 'confirmed')
        and terms_snapshot->>'checkoutSessionReference' = ${input.checkoutSessionReference}
      order by case when status = 'pending' then 0 else 1 end
      limit 1
    `);
    const rows = Array.isArray(found) ? found : ((found as { rows?: unknown[] }).rows ?? []);
    const row = rows[0] as
      | {
          id: string;
          unit_id: string;
          tenant_party_id: string;
          status: string;
          currency: string;
          terms_snapshot: Record<string, unknown> | null;
        }
      | undefined;
    if (!row) throw new NotFoundException('Booking checkout session not found');

    const snapshot = (row.terms_snapshot ?? {}) as Record<string, unknown>;
    const expectedDeposit =
      typeof snapshot.depositMinor === 'string' && /^\d+$/.test(snapshot.depositMinor)
        ? snapshot.depositMinor
        : null;
    if (!expectedDeposit || expectedDeposit !== input.amountMinor)
      throw new ConflictException('Webhook amount does not match booking deposit');
    const expectedCurrency =
      (typeof snapshot.currency === 'string' ? snapshot.currency : row.currency) ?? input.currency;
    if (expectedCurrency !== input.currency)
      throw new ConflictException('Webhook currency does not match booking deposit');

    if (row.status === 'confirmed') {
      // Idempotent replay after successful prior webhook / accountant confirm.
      return;
    }

    const depositMinor = BigInt(input.amountMinor);
    const journal = await this.postReservationDepositJournal(transaction, input.organizationId, {
      reservationId: row.id,
      partyId: row.tenant_party_id,
      unitId: row.unit_id,
      currency: input.currency,
      depositMinor,
      occurredOn: input.receivedAt.slice(0, 10),
    });

    const termsSnapshot = {
      ...snapshot,
      awaitingPublicDepositPayment: false,
      awaitingAccountantDeposit: false,
      publicDepositPaidAt: input.receivedAt,
      depositConfirmedAt: input.receivedAt,
      depositConfirmedVia: 'payment_webhook',
      depositProvider: input.provider,
      depositProviderReference: input.providerReference,
      depositPaymentMethod: input.method,
      depositJournalEntryId: journal?.id ?? null,
    };

    await transaction
      .update(reservations)
      .set({
        status: 'confirmed',
        termsSnapshot,
        updatedAt: new Date(),
      })
      .where(
        and(eq(reservations.id, row.id), eq(reservations.organizationId, input.organizationId)),
      );

    await transaction
      .update(holds)
      .set({ status: 'converted', updatedAt: new Date() })
      .where(
        and(
          eq(holds.organizationId, input.organizationId),
          eq(holds.unitId, row.unit_id),
          eq(holds.prospectPartyId, row.tenant_party_id),
          eq(holds.status, 'active'),
        ),
      );

    await transaction.insert(workflowEvents).values({
      organizationId: input.organizationId,
      actorUserId: null,
      resourceType: 'reservation',
      resourceId: row.id,
      eventType: 'reservation.deposit_confirmed',
      fromStatus: 'pending',
      toStatus: 'confirmed',
      note: `Webhook ${input.provider}:${input.providerReference}`,
    });

    await transaction.insert(outboxEvents).values({
      organizationId: input.organizationId,
      topic: 'reservation.deposit_confirmed',
      aggregateType: 'reservation',
      aggregateId: row.id,
      payload: {
        checkoutSessionReference: input.checkoutSessionReference,
        provider: input.provider,
        providerReference: input.providerReference,
        amountMinor: input.amountMinor,
        currency: input.currency,
      },
    });
  }

  listCheques(claims: SessionClaims) {
    return this.database.withinTenant(claims, async (transaction) =>
      transaction
        .select()
        .from(cheques)
        .where(eq(cheques.organizationId, claims.organizationId!))
        .orderBy(asc(cheques.dueOn)),
    );
  }

  createCheque(
    claims: SessionClaims,
    input: {
      ownerPartyId: string;
      bankName: string;
      chequeNumber: string;
      amountMinor: string;
      currency: CurrencyCode;
      dueOn: string;
      reservationId?: string | undefined;
      leaseId?: string | undefined;
      attachmentMediaId?: string | undefined;
    },
  ) {
    return this.database.withinTenant(claims, async (transaction) => {
      const owner = await transaction.query.parties.findFirst({
        where: and(
          eq(parties.id, input.ownerPartyId),
          eq(parties.organizationId, claims.organizationId!),
        ),
      });
      if (!owner) throw new NotFoundException('Cheque owner party not found');
      const rows = await transaction
        .insert(cheques)
        .values({
          organizationId: claims.organizationId!,
          ownerPartyId: input.ownerPartyId,
          bankName: input.bankName,
          chequeNumber: input.chequeNumber.trim(),
          amountMinor: BigInt(input.amountMinor),
          currency: input.currency,
          dueOn: input.dueOn,
          reservationId: input.reservationId,
          leaseId: input.leaseId,
          attachmentMediaId: input.attachmentMediaId,
        })
        .returning();
      await transaction.insert(outboxEvents).values({
        organizationId: claims.organizationId!,
        topic: 'cheque.created',
        aggregateType: 'cheque',
        aggregateId: rows[0]!.id,
        payload: { chequeId: rows[0]!.id, reviewStatus: rows[0]!.reviewStatus },
      });
      return {
        ...rows[0]!,
        amountMinor: rows[0]!.amountMinor.toString(),
      };
    });
  }

  reviewCheque(
    claims: SessionClaims,
    chequeId: string,
    input: {
      reviewStatus: 'accepted' | 'rejected' | 'deposited' | 'cleared' | 'bounced' | 'cancelled';
      notes?: string | undefined;
    },
  ) {
    return this.database.withinTenant(claims, async (transaction) => {
      const existing = await transaction.query.cheques.findFirst({
        where: and(eq(cheques.id, chequeId), eq(cheques.organizationId, claims.organizationId!)),
      });
      if (!existing) throw new NotFoundException('Cheque not found');
      const transition = assertTransition(chequeMachine, existing.reviewStatus, input.reviewStatus);
      if (!transition.ok) throw new ConflictException(transition.reason);
      const rows = await transaction
        .update(cheques)
        .set({
          reviewStatus: input.reviewStatus,
          reviewedByUserId: claims.sub,
          reviewedAt: new Date(),
          reviewNotes: input.notes,
          updatedAt: new Date(),
        })
        .where(and(eq(cheques.id, chequeId), eq(cheques.organizationId, claims.organizationId!)))
        .returning();
      return {
        ...rows[0]!,
        amountMinor: rows[0]!.amountMinor.toString(),
      };
    });
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
      billingPeriodStart: invoice.billingPeriodStart,
      billingPeriodEnd: invoice.billingPeriodEnd,
      documentReady: Boolean(invoice.renderedPdfObjectKey && invoice.renderedPdfHash),
      documentHash: invoice.renderedPdfHash,
      createdAt: invoice.createdAt,
      updatedAt: invoice.updatedAt,
    };
  }
}
