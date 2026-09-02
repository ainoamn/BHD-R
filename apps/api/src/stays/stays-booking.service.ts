import { createHash, randomBytes } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  outboxEvents,
  stayBookingGuests,
  stayBookingStatusHistory,
  stayBookings,
  stayFolios,
  stayHolds,
  stayPaymentIntents,
  stayQuotes,
  workflowEvents,
} from '@bhd-r/db';
import { resolveStaysEnabledFromEnv } from '@bhd-r/config';
import type {
  CreateStayBookingInput,
  CreateStayHoldInput,
  CreateStayQuoteInput,
  StayAvailabilityQuery,
  StayInventoryCalendarQuery,
} from '@bhd-r/contracts';
import {
  assertStayBookingTransition,
  nightsBetween,
  quoteStay,
  stayRangeFullyAvailable,
  type StayBookingStatus,
  type SupportedCurrency,
} from '@bhd-r/domain';
import type { SessionClaims } from '@bhd-r/authz';
import { DatabaseService, type DatabaseTransaction } from '../database/database.service.js';
import { StaysInventoryService } from './stays-inventory.service.js';

const QUOTE_TTL_MS = 30 * 60_000;
const HOLD_TTL_MS = 15 * 60_000;

type ListingContext = {
  organizationId: string;
  propertyId: string;
  unitTypeId: string;
  unitId: string;
  stayProfileId: string;
  slug: string;
  instantBook: boolean;
  currency: SupportedCurrency;
  minorUnit: number;
  maxGuests: number;
  minNights: number;
  maxNights: number;
  timezone: string;
  baseNightlyMinor: string;
  weekendNightlyMinor: string | null;
  cleaningFeeMinor: string | null;
};

/**
 * Phase 5+ — quote → hold → pay → confirm → stay → checkout.
 * Payment webhook kind `stay_booking` is handled in FinanceService.ingestWebhook.
 */
@Injectable()
export class StaysBookingService {
  private readonly logger = new Logger(StaysBookingService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly inventory: StaysInventoryService,
  ) {}

  assertTransition(from: StayBookingStatus, to: StayBookingStatus): void {
    const result = assertStayBookingTransition(from, to);
    if (!result.ok) {
      throw new Error(result.reason ?? 'illegal_stay_transition');
    }
  }

  describePaymentHook(): { kind: 'stay_booking'; note: string } {
    return {
      kind: 'stay_booking',
      note: 'POST /v1/webhooks/payments/:provider with kind stay_booking + paymentIntentId; amount/currency match; unique x-event-id.',
    };
  }

  async getAvailability(slug: string, query: StayAvailabilityQuery) {
    const ctx = await this.resolveListingContext(slug);
    this.assertOrgEnabled(ctx.organizationId);
    const guests = query.adults + query.children;
    if (guests > ctx.maxGuests) {
      return { available: false, reason: 'guests_exceed_max' as const };
    }
    const nights = nightsBetween({
      checkInOn: query.checkInOn,
      checkOutOn: query.checkOutOn,
    });
    if (nights < ctx.minNights || nights > ctx.maxNights) {
      return { available: false, reason: 'nights_out_of_range' as const, nights };
    }
    const available = await this.isRangeAvailable(
      ctx.organizationId,
      ctx.unitId,
      query.checkInOn,
      query.checkOutOn,
    );
    return { available, nights, unitId: ctx.unitId, currency: ctx.currency };
  }

  async getInventoryCalendar(slug: string, query: StayInventoryCalendarQuery) {
    const ctx = await this.resolveListingContext(slug);
    this.assertOrgEnabled(ctx.organizationId);
    return this.inventory.getPublicInventoryCalendar(
      ctx.organizationId,
      ctx.unitId,
      query.fromOn,
      query.toOn,
      ctx.currency,
    );
  }

  async createQuote(slug: string, input: CreateStayQuoteInput) {
    const ctx = await this.resolveListingContext(slug);
    this.assertOrgEnabled(ctx.organizationId);
    const guests = input.adults + input.children;
    if (guests > ctx.maxGuests) {
      throw new ConflictException('Guest count exceeds unit maximum');
    }
    const nights = nightsBetween({
      checkInOn: input.checkInOn,
      checkOutOn: input.checkOutOn,
    });
    if (nights < ctx.minNights || nights > ctx.maxNights) {
      throw new ConflictException('Stay length is outside profile min/max nights');
    }
    const available = await this.isRangeAvailable(
      ctx.organizationId,
      ctx.unitId,
      input.checkInOn,
      input.checkOutOn,
    );
    if (!available) throw new ConflictException('Selected dates are not available');

    const nightRates = await this.database.asPublic(async (transaction) => {
      const result = await transaction.execute(sql`
        SELECT stay_date::text AS stay_date, effective_rate_minor::text AS effective_rate_minor
        FROM stay_inventory_days
        WHERE organization_id = ${ctx.organizationId}::uuid
          AND unit_id = ${ctx.unitId}::uuid
          AND stay_date >= ${input.checkInOn}::date
          AND stay_date < ${input.checkOutOn}::date
          AND effective_rate_minor IS NOT NULL
      `);
      const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
      const map: Record<string, string> = {};
      for (const row of rows as Array<{ stay_date: string; effective_rate_minor: string }>) {
        map[row.stay_date] = row.effective_rate_minor;
      }
      return map;
    });

    const priced = quoteStay({
      currency: ctx.currency,
      checkInOn: input.checkInOn,
      checkOutOn: input.checkOutOn,
      baseNightlyMinor: ctx.baseNightlyMinor,
      weekendNightlyMinor: ctx.weekendNightlyMinor,
      cleaningFeeMinor: ctx.cleaningFeeMinor,
      ...(Object.keys(nightRates).length ? { nightRateOverrides: nightRates } : {}),
    });

    const payloadHash = createHash('sha256')
      .update(
        JSON.stringify({
          unitId: ctx.unitId,
          checkInOn: input.checkInOn,
          checkOutOn: input.checkOutOn,
          adults: input.adults,
          children: input.children,
          totalMinor: priced.totalMinor,
        }),
      )
      .digest('hex');

    const expiresAt = new Date(Date.now() + QUOTE_TTL_MS);

    return this.database.asPublic(async (transaction) => {
      const [quote] = await transaction
        .insert(stayQuotes)
        .values({
          organizationId: ctx.organizationId,
          stayProfileId: ctx.stayProfileId,
          unitId: ctx.unitId,
          checkInOn: input.checkInOn,
          checkOutOn: input.checkOutOn,
          nights: priced.nights,
          adults: input.adults,
          children: input.children,
          currency: priced.currency,
          minorUnit: priced.minorUnit,
          subtotalMinor: BigInt(priced.subtotalMinor),
          feesMinor: BigInt(priced.cleaningFeeMinor),
          taxMinor: 0n,
          totalMinor: BigInt(priced.totalMinor),
          lineItemsJson: priced.nightLines,
          feesSnapshotJson: [
            {
              code: 'cleaning',
              amountMinor: priced.cleaningFeeMinor,
            },
          ],
          payloadHash,
          expiresAt,
        })
        .returning();

      await transaction.insert(outboxEvents).values({
        organizationId: ctx.organizationId,
        topic: 'stay.quote.created',
        aggregateType: 'stay_quote',
        aggregateId: quote!.id,
        payload: {
          slug,
          unitId: ctx.unitId,
          checkInOn: input.checkInOn,
          checkOutOn: input.checkOutOn,
          totalMinor: priced.totalMinor,
          currency: priced.currency,
        },
      });

      return {
        id: quote!.id,
        organizationId: ctx.organizationId,
        stayProfileId: ctx.stayProfileId,
        unitId: ctx.unitId,
        checkInOn: input.checkInOn,
        checkOutOn: input.checkOutOn,
        nights: priced.nights,
        adults: input.adults,
        children: input.children,
        currency: priced.currency,
        minorUnit: priced.minorUnit,
        subtotalMinor: priced.subtotalMinor,
        feesMinor: priced.cleaningFeeMinor,
        taxMinor: '0',
        totalMinor: priced.totalMinor,
        expiresAt: expiresAt.toISOString(),
        payloadHash,
      };
    });
  }

  async createHold(input: CreateStayHoldInput, idempotencyKey: string) {
    return this.database.asPublic(async (transaction) => {
      const existing = await transaction.query.stayHolds.findFirst({
        where: and(
          eq(stayHolds.idempotencyKey, idempotencyKey),
          eq(stayHolds.quoteId, input.quoteId),
        ),
      });
      if (existing) {
        return {
          id: existing.id,
          quoteId: existing.quoteId,
          inventoryLockId: existing.inventoryLockId,
          status: existing.status,
          expiresAt: existing.expiresAt.toISOString(),
          duplicate: true as const,
        };
      }

      const quote = await transaction.query.stayQuotes.findFirst({
        where: eq(stayQuotes.id, input.quoteId),
      });
      if (!quote) throw new NotFoundException('Stay quote not found');
      this.assertOrgEnabled(quote.organizationId);
      if (quote.expiresAt.getTime() <= Date.now()) {
        throw new ConflictException('Stay quote has expired');
      }

      const available = await this.isRangeAvailableInTransaction(
        transaction,
        quote.organizationId,
        quote.unitId,
        quote.checkInOn,
        quote.checkOutOn,
      );
      if (!available) throw new ConflictException('Selected dates are no longer available');

      const expiresAt = new Date(Date.now() + HOLD_TTL_MS);
      const lock = await this.inventory.createLockInTransaction(transaction, {
        organizationId: quote.organizationId,
        unitId: quote.unitId,
        checkInOn: quote.checkInOn,
        checkOutOn: quote.checkOutOn,
        kind: 'hold',
        expiresAt,
        sourceType: 'stay_quote',
        sourceId: quote.id,
        note: 'Public stay hold',
      });

      const [hold] = await transaction
        .insert(stayHolds)
        .values({
          organizationId: quote.organizationId,
          quoteId: quote.id,
          inventoryLockId: lock.id,
          status: 'active',
          expiresAt,
          idempotencyKey,
        })
        .returning();

      await transaction.insert(outboxEvents).values({
        organizationId: quote.organizationId,
        topic: 'stay.hold.created',
        aggregateType: 'stay_hold',
        aggregateId: hold!.id,
        payload: {
          quoteId: quote.id,
          unitId: quote.unitId,
          inventoryLockId: lock.id,
          expiresAt: expiresAt.toISOString(),
        },
      });

      return {
        id: hold!.id,
        quoteId: quote.id,
        inventoryLockId: lock.id,
        status: 'active' as const,
        expiresAt: expiresAt.toISOString(),
        duplicate: false as const,
      };
    });
  }

  async createBookingFromHold(input: CreateStayBookingInput, idempotencyKey: string) {
    return this.database.asPublic(async (transaction) => {
      const hold = await transaction.query.stayHolds.findFirst({
        where: eq(stayHolds.id, input.holdId),
      });
      if (!hold) throw new NotFoundException('Stay hold not found');
      this.assertOrgEnabled(hold.organizationId);
      if (hold.status !== 'active' || hold.expiresAt.getTime() <= Date.now()) {
        throw new ConflictException('Stay hold is not active');
      }

      const existingIntent = await transaction.query.stayPaymentIntents.findFirst({
        where: and(
          eq(stayPaymentIntents.organizationId, hold.organizationId),
          eq(stayPaymentIntents.idempotencyKey, idempotencyKey),
        ),
      });
      if (existingIntent) {
        const booking = await transaction.query.stayBookings.findFirst({
          where: eq(stayBookings.id, existingIntent.bookingId),
        });
        if (!booking) throw new ConflictException('Booking missing for payment intent');
        return {
          bookingId: booking.id,
          referenceCode: booking.referenceCode,
          status: booking.status,
          paymentIntentId: existingIntent.id,
          amountMinor: existingIntent.amountMinor.toString(),
          currency: existingIntent.currency,
          duplicate: true as const,
        };
      }

      const quote = await transaction.query.stayQuotes.findFirst({
        where: eq(stayQuotes.id, hold.quoteId),
      });
      if (!quote) throw new NotFoundException('Stay quote not found');

      const profile = await transaction.execute(sql`
        SELECT
          sut.property_id,
          sp.unit_type_id,
          sp.instant_book,
          sp.timezone
        FROM stay_profiles sp
        INNER JOIN stay_unit_types sut ON sut.id = sp.unit_type_id
        WHERE sp.id = ${quote.stayProfileId}::uuid
        LIMIT 1
      `);
      const profileRows = Array.isArray(profile)
        ? profile
        : ((profile as { rows?: unknown[] }).rows ?? []);
      const profileRow = profileRows[0] as
        | {
            property_id: string;
            unit_type_id: string;
            instant_book: boolean;
            timezone: string;
          }
        | undefined;
      if (!profileRow) throw new NotFoundException('Stay profile not found');

      const bookingMode = profileRow.instant_book ? 'instant' : 'request';
      const status: StayBookingStatus =
        bookingMode === 'instant' ? 'payment_pending' : 'request_pending';
      const referenceCode = `ST-${randomBytes(4).toString('hex').toUpperCase()}`;

      const [booking] = await transaction
        .insert(stayBookings)
        .values({
          organizationId: hold.organizationId,
          propertyId: profileRow.property_id,
          unitTypeId: profileRow.unit_type_id,
          unitId: quote.unitId,
          stayProfileId: quote.stayProfileId,
          referenceCode,
          checkInOn: quote.checkInOn,
          checkOutOn: quote.checkOutOn,
          timezone: profileRow.timezone,
          status,
          bookingMode,
          source: 'direct',
          quoteId: quote.id,
          holdId: hold.id,
          inventoryLockId: hold.inventoryLockId,
          currency: quote.currency,
          minorUnit: quote.minorUnit,
          subtotalMinor: quote.subtotalMinor,
          feesMinor: quote.feesMinor,
          taxMinor: quote.taxMinor,
          totalMinor: quote.totalMinor,
          pricingSnapshotJson: {
            lineItems: quote.lineItemsJson,
            fees: quote.feesSnapshotJson,
          },
        })
        .returning();

      if (input.guestDisplayName) {
        await transaction.insert(stayBookingGuests).values({
          organizationId: hold.organizationId,
          bookingId: booking!.id,
          isPrimary: true,
          displayName: input.guestDisplayName,
          guestType: 'adult',
        });
      }

      await transaction.insert(stayBookingStatusHistory).values({
        organizationId: hold.organizationId,
        bookingId: booking!.id,
        fromStatus: null,
        toStatus: status,
        reason: 'public_booking_created',
      });

      const [folio] = await transaction
        .insert(stayFolios)
        .values({
          organizationId: hold.organizationId,
          bookingId: booking!.id,
          status: 'open',
          currency: quote.currency,
          balanceMinor: quote.totalMinor,
        })
        .returning();

      const [intent] = await transaction
        .insert(stayPaymentIntents)
        .values({
          organizationId: hold.organizationId,
          bookingId: booking!.id,
          folioId: folio!.id,
          status: 'pending',
          amountMinor: quote.totalMinor,
          currency: quote.currency,
          idempotencyKey,
        })
        .returning();

      await transaction
        .update(stayHolds)
        .set({ status: 'converted', updatedAt: new Date() })
        .where(
          and(
            eq(stayHolds.id, hold.id),
            eq(stayHolds.organizationId, hold.organizationId),
            eq(stayHolds.status, 'active'),
          ),
        );

      await transaction.insert(workflowEvents).values({
        organizationId: hold.organizationId,
        actorUserId: null,
        resourceType: 'stay_booking',
        resourceId: booking!.id,
        eventType: 'stay.booking.requested',
        fromStatus: null,
        toStatus: status,
      });

      await transaction.insert(outboxEvents).values({
        organizationId: hold.organizationId,
        topic: 'stay.booking.requested',
        aggregateType: 'stay_booking',
        aggregateId: booking!.id,
        payload: {
          holdId: hold.id,
          paymentIntentId: intent!.id,
          unitId: quote.unitId,
          totalMinor: quote.totalMinor.toString(),
          currency: quote.currency,
          status,
        },
      });

      return {
        bookingId: booking!.id,
        referenceCode: booking!.referenceCode,
        status: booking!.status,
        paymentIntentId: intent!.id,
        amountMinor: intent!.amountMinor.toString(),
        currency: intent!.currency,
        duplicate: false as const,
      };
    });
  }

  async getPublicByReference(referenceCode: string) {
    const normalized = referenceCode.trim().toUpperCase();
    const booking = await this.database.asPublic(async (transaction) =>
      transaction.query.stayBookings.findFirst({
        where: eq(stayBookings.referenceCode, normalized),
      }),
    );
    if (!booking) throw new NotFoundException();
    this.assertOrgEnabled(booking.organizationId);
    return this.toGuestProjection(booking);
  }

  async listForUser(userId: string) {
    const rows = await this.database.asPublic(async (transaction) =>
      transaction
        .select()
        .from(stayBookings)
        .where(eq(stayBookings.userId, userId))
        .orderBy(desc(stayBookings.checkInOn), desc(stayBookings.createdAt))
        .limit(50),
    );
    return {
      items: rows
        .filter((row) => {
          try {
            this.assertOrgEnabled(row.organizationId);
            return true;
          } catch {
            return false;
          }
        })
        .map((row) => this.toGuestProjection(row)),
    };
  }

  async getForUser(userId: string, bookingId: string) {
    const booking = await this.database.asPublic(async (transaction) =>
      transaction.query.stayBookings.findFirst({
        where: and(eq(stayBookings.id, bookingId), eq(stayBookings.userId, userId)),
      }),
    );
    if (!booking) throw new NotFoundException();
    this.assertOrgEnabled(booking.organizationId);
    return this.toGuestProjection(booking);
  }

  async claimForUser(userId: string, referenceCode: string) {
    const normalized = referenceCode.trim().toUpperCase();
    return this.database.asPublic(async (transaction) => {
      const booking = await transaction.query.stayBookings.findFirst({
        where: eq(stayBookings.referenceCode, normalized),
      });
      if (!booking) throw new NotFoundException();
      this.assertOrgEnabled(booking.organizationId);

      if (booking.userId === userId) {
        return { ...this.toGuestProjection(booking), duplicate: true as const };
      }
      if (booking.userId) {
        throw new ConflictException('Stay booking is already linked to another account');
      }

      const [updated] = await transaction
        .update(stayBookings)
        .set({ userId, updatedAt: new Date() })
        .where(
          and(
            eq(stayBookings.id, booking.id),
            eq(stayBookings.organizationId, booking.organizationId),
            sql`${stayBookings.userId} IS NULL`,
          ),
        )
        .returning();
      if (!updated) throw new ConflictException('Stay booking could not be claimed');

      await transaction.insert(outboxEvents).values({
        organizationId: booking.organizationId,
        topic: 'stay.booking.claimed',
        aggregateType: 'stay_booking',
        aggregateId: booking.id,
        payload: { userId, referenceCode: booking.referenceCode },
      });

      return { ...this.toGuestProjection(updated), duplicate: false as const };
    });
  }

  async listForOrganization(
    claims: SessionClaims,
    query: { status?: string | undefined; propertyId?: string | undefined; limit: number },
  ) {
    const organizationId = claims.organizationId;
    if (!organizationId) throw new ConflictException('Organization context required');

    return this.database.withinTenant(claims, async (transaction) => {
      const filters = [eq(stayBookings.organizationId, organizationId)];
      if (query.status) {
        filters.push(eq(stayBookings.status, query.status));
      }
      if (query.propertyId) {
        filters.push(eq(stayBookings.propertyId, query.propertyId));
      }

      const rows = await transaction
        .select()
        .from(stayBookings)
        .where(and(...filters))
        .orderBy(desc(stayBookings.checkInOn), desc(stayBookings.createdAt))
        .limit(query.limit);

      return {
        items: rows.map((row) => this.toOpsProjection(row)),
      };
    });
  }

  async getForOrganization(claims: SessionClaims, bookingId: string) {
    const organizationId = claims.organizationId;
    if (!organizationId) throw new ConflictException('Organization context required');

    return this.database.withinTenant(claims, async (transaction) => {
      const booking = await transaction.query.stayBookings.findFirst({
        where: and(
          eq(stayBookings.id, bookingId),
          eq(stayBookings.organizationId, organizationId),
        ),
      });
      if (!booking) throw new NotFoundException('Stay booking not found');
      return this.toOpsProjection(booking);
    });
  }

  async checkOut(claims: SessionClaims, bookingId: string) {
    const organizationId = claims.organizationId;
    if (!organizationId) throw new ConflictException('Organization context required');

    return this.database.withinTenant(claims, async (transaction) => {
      const booking = await transaction.query.stayBookings.findFirst({
        where: and(
          eq(stayBookings.id, bookingId),
          eq(stayBookings.organizationId, organizationId),
        ),
      });
      if (!booking) throw new NotFoundException('Stay booking not found');

      if (booking.status === 'checked_out') {
        return { id: booking.id, status: booking.status, duplicate: true };
      }

      const transition = assertStayBookingTransition(booking.status, 'checked_out');
      if (!transition.ok) {
        throw new ConflictException(transition.reason ?? 'Illegal stay checkout transition');
      }

      await transaction
        .update(stayBookings)
        .set({ status: 'checked_out', updatedAt: new Date() })
        .where(
          and(eq(stayBookings.id, booking.id), eq(stayBookings.organizationId, organizationId)),
        );

      await transaction.insert(stayBookingStatusHistory).values({
        organizationId,
        bookingId: booking.id,
        fromStatus: booking.status,
        toStatus: 'checked_out',
        actorUserId: claims.sub,
        reason: 'ops_checkout',
      });

      await transaction.insert(workflowEvents).values({
        organizationId,
        actorUserId: claims.sub,
        resourceType: 'stay_booking',
        resourceId: booking.id,
        eventType: 'stay.checked_out',
        fromStatus: booking.status,
        toStatus: 'checked_out',
      });

      await transaction.insert(outboxEvents).values({
        organizationId,
        topic: 'stay.checked_out',
        aggregateType: 'stay_booking',
        aggregateId: booking.id,
        payload: {
          unitId: booking.unitId,
          checkOutOn: booking.checkOutOn,
        },
      });

      this.logger.log(`Stay booking ${booking.id} checked out`);
      return { id: booking.id, status: 'checked_out' as const, duplicate: false };
    });
  }

  async cancel(claims: SessionClaims, bookingId: string) {
    return this.applyOpsTerminalStatus(claims, bookingId, {
      toStatus: 'cancelled',
      reason: 'ops_cancel',
      eventType: 'stay.cancelled',
      topic: 'stay.cancelled',
    });
  }

  async markNoShow(claims: SessionClaims, bookingId: string) {
    return this.applyOpsTerminalStatus(claims, bookingId, {
      toStatus: 'no_show',
      reason: 'ops_no_show',
      eventType: 'stay.no_show',
      topic: 'stay.no_show',
    });
  }

  private async applyOpsTerminalStatus(
    claims: SessionClaims,
    bookingId: string,
    input: {
      toStatus: 'cancelled' | 'no_show';
      reason: string;
      eventType: string;
      topic: string;
    },
  ) {
    const organizationId = claims.organizationId;
    if (!organizationId) throw new ConflictException('Organization context required');

    return this.database.withinTenant(claims, async (transaction) => {
      const booking = await transaction.query.stayBookings.findFirst({
        where: and(
          eq(stayBookings.id, bookingId),
          eq(stayBookings.organizationId, organizationId),
        ),
      });
      if (!booking) throw new NotFoundException('Stay booking not found');

      if (booking.status === input.toStatus) {
        return { id: booking.id, status: booking.status, duplicate: true as const };
      }

      const transition = assertStayBookingTransition(
        booking.status as StayBookingStatus,
        input.toStatus,
      );
      if (!transition.ok) {
        throw new ConflictException(transition.reason ?? `Illegal stay ${input.toStatus} transition`);
      }

      const now = new Date();

      await transaction
        .update(stayBookings)
        .set({ status: input.toStatus, updatedAt: now })
        .where(
          and(eq(stayBookings.id, booking.id), eq(stayBookings.organizationId, organizationId)),
        );

      await this.inventory.releaseLockInTransaction(transaction, {
        organizationId,
        lockId: booking.inventoryLockId,
        reason: input.reason,
      });

      await transaction
        .update(stayPaymentIntents)
        .set({ status: 'cancelled', updatedAt: now })
        .where(
          and(
            eq(stayPaymentIntents.bookingId, booking.id),
            eq(stayPaymentIntents.organizationId, organizationId),
            eq(stayPaymentIntents.status, 'pending'),
          ),
        );

      if (booking.holdId) {
        await transaction
          .update(stayHolds)
          .set({ status: 'cancelled', updatedAt: now })
          .where(
            and(
              eq(stayHolds.id, booking.holdId),
              eq(stayHolds.organizationId, organizationId),
              eq(stayHolds.status, 'active'),
            ),
          );
      }

      await transaction.insert(stayBookingStatusHistory).values({
        organizationId,
        bookingId: booking.id,
        fromStatus: booking.status,
        toStatus: input.toStatus,
        actorUserId: claims.sub,
        reason: input.reason,
      });

      await transaction.insert(workflowEvents).values({
        organizationId,
        actorUserId: claims.sub,
        resourceType: 'stay_booking',
        resourceId: booking.id,
        eventType: input.eventType,
        fromStatus: booking.status,
        toStatus: input.toStatus,
      });

      await transaction.insert(outboxEvents).values({
        organizationId,
        topic: input.topic,
        aggregateType: 'stay_booking',
        aggregateId: booking.id,
        payload: {
          unitId: booking.unitId,
          checkInOn: booking.checkInOn,
          checkOutOn: booking.checkOutOn,
          fromStatus: booking.status,
        },
      });

      this.logger.log(`Stay booking ${booking.id} → ${input.toStatus}`);
      return { id: booking.id, status: input.toStatus, duplicate: false as const };
    });
  }

  private assertOrgEnabled(organizationId: string): void {
    const resolution = resolveStaysEnabledFromEnv({
      organizationId,
      propertyEnabled: true,
      unitEnabled: true,
    });
    if (!resolution.enabled) {
      throw new NotFoundException();
    }
  }

  private toGuestProjection(booking: {
    id: string;
    referenceCode: string;
    organizationId: string;
    propertyId: string;
    unitTypeId: string;
    unitId: string;
    checkInOn: string;
    checkOutOn: string;
    timezone: string;
    status: string;
    bookingMode: string;
    currency: string;
    totalMinor: bigint;
  }) {
    return {
      id: booking.id,
      referenceCode: booking.referenceCode,
      organizationId: booking.organizationId,
      propertyId: booking.propertyId,
      unitTypeId: booking.unitTypeId,
      unitId: booking.unitId,
      checkInOn: booking.checkInOn,
      checkOutOn: booking.checkOutOn,
      timezone: booking.timezone,
      status: booking.status,
      bookingMode: booking.bookingMode,
      currency: booking.currency,
      totalMinor: booking.totalMinor.toString(),
      nights: nightsBetween({
        checkInOn: booking.checkInOn,
        checkOutOn: booking.checkOutOn,
      }),
    };
  }

  private toOpsProjection(booking: {
    id: string;
    referenceCode: string;
    organizationId: string;
    propertyId: string;
    unitTypeId: string;
    unitId: string;
    checkInOn: string;
    checkOutOn: string;
    timezone: string;
    status: string;
    bookingMode: string;
    source: string;
    currency: string;
    subtotalMinor: bigint;
    feesMinor: bigint;
    taxMinor: bigint;
    totalMinor: bigint;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      ...this.toGuestProjection(booking),
      source: booking.source,
      subtotalMinor: booking.subtotalMinor.toString(),
      feesMinor: booking.feesMinor.toString(),
      taxMinor: booking.taxMinor.toString(),
      createdAt: booking.createdAt.toISOString(),
      updatedAt: booking.updatedAt.toISOString(),
    };
  }

  private async resolveListingContext(slug: string): Promise<ListingContext> {
    const rows = await this.database.asPublic(async (transaction) => {
      const result = await transaction.execute(sql`
        SELECT
          spl.organization_id,
          spl.property_id,
          spl.unit_type_id,
          spl.slug,
          sp.id AS stay_profile_id,
          sp.unit_id,
          sp.instant_book,
          sp.currency,
          sp.minor_unit,
          sp.max_guests,
          sp.min_nights,
          sp.max_nights,
          sp.timezone,
          (
            SELECT srp.base_nightly_minor::text
            FROM stay_rate_plans srp
            WHERE srp.stay_profile_id = sp.id
              AND srp.enabled = true
            ORDER BY srp.priority ASC, srp.created_at ASC
            LIMIT 1
          ) AS base_nightly_minor,
          (
            SELECT srp.weekend_nightly_minor::text
            FROM stay_rate_plans srp
            WHERE srp.stay_profile_id = sp.id
              AND srp.enabled = true
            ORDER BY srp.priority ASC, srp.created_at ASC
            LIMIT 1
          ) AS weekend_nightly_minor,
          (
            SELECT sf.amount_minor::text
            FROM stay_fees sf
            WHERE sf.stay_profile_id = sp.id
              AND sf.enabled = true
              AND sf.fee_kind = 'cleaning'
            ORDER BY sf.created_at ASC
            LIMIT 1
          ) AS cleaning_fee_minor
        FROM stay_public_listings spl
        INNER JOIN stay_profiles sp
          ON sp.unit_type_id = spl.unit_type_id
         AND sp.organization_id = spl.organization_id
         AND sp.enabled = true
         AND sp.publish_status = 'published'
        WHERE spl.slug = ${slug}
          AND spl.enabled = true
          AND spl.published_at IS NOT NULL
        ORDER BY sp.updated_at DESC
        LIMIT 1
      `);
      return Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
    });

    const row = rows[0] as
      | {
          organization_id: string;
          property_id: string;
          unit_type_id: string;
          slug: string;
          stay_profile_id: string;
          unit_id: string;
          instant_book: boolean;
          currency: string;
          minor_unit: number;
          max_guests: number;
          min_nights: number;
          max_nights: number;
          timezone: string;
          base_nightly_minor: string | null;
          weekend_nightly_minor: string | null;
          cleaning_fee_minor: string | null;
        }
      | undefined;
    if (!row?.base_nightly_minor) throw new NotFoundException('Stay listing not found');

    return {
      organizationId: row.organization_id,
      propertyId: row.property_id,
      unitTypeId: row.unit_type_id,
      unitId: row.unit_id,
      stayProfileId: row.stay_profile_id,
      slug: row.slug,
      instantBook: row.instant_book,
      currency: row.currency as SupportedCurrency,
      minorUnit: row.minor_unit,
      maxGuests: row.max_guests,
      minNights: row.min_nights,
      maxNights: row.max_nights,
      timezone: row.timezone,
      baseNightlyMinor: row.base_nightly_minor,
      weekendNightlyMinor: row.weekend_nightly_minor,
      cleaningFeeMinor: row.cleaning_fee_minor,
    };
  }

  private async isRangeAvailable(
    organizationId: string,
    unitId: string,
    checkInOn: string,
    checkOutOn: string,
  ): Promise<boolean> {
    return this.database.asPublic((transaction) =>
      this.isRangeAvailableInTransaction(transaction, organizationId, unitId, checkInOn, checkOutOn),
    );
  }

  private async isRangeAvailableInTransaction(
    transaction: DatabaseTransaction,
    organizationId: string,
    unitId: string,
    checkInOn: string,
    checkOutOn: string,
  ): Promise<boolean> {
    const days = await transaction.execute(sql<{
      stay_date: string;
      availability_status: string;
    }>`
      SELECT stay_date::text AS stay_date, availability_status
      FROM stay_inventory_days
      WHERE organization_id = ${organizationId}::uuid
        AND unit_id = ${unitId}::uuid
        AND stay_date >= ${checkInOn}::date
        AND stay_date < ${checkOutOn}::date
      ORDER BY stay_date
    `);
    const rows = Array.isArray(days) ? days : ((days as { rows?: unknown[] }).rows ?? []);
    const mapped = rows.map((row) => {
      const item = row as { stay_date: string; availability_status: string };
      return { stayDate: item.stay_date, availabilityStatus: item.availability_status };
    });
    if (mapped.length > 0) {
      return stayRangeFullyAvailable(mapped, { checkInOn, checkOutOn });
    }

    // No projection yet: fall back to active locks overlap check.
    const conflicts = await transaction.execute(sql<{ count: string }>`
      SELECT count(*)::text AS count
      FROM stay_inventory_locks
      WHERE organization_id = ${organizationId}::uuid
        AND unit_id = ${unitId}::uuid
        AND status = 'active'
        AND stay_range && daterange(${checkInOn}::date, ${checkOutOn}::date, '[)')
    `);
    const conflictRows = Array.isArray(conflicts)
      ? conflicts
      : ((conflicts as { rows?: Array<{ count: string }> }).rows ?? []);
    return (conflictRows[0]?.count ?? '0') === '0';
  }
}
