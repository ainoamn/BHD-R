import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNotNull, lte, sql } from 'drizzle-orm';
import {
  outboxEvents,
  stayHolds,
  stayInventoryDays,
  stayInventoryLocks,
  stayProfiles,
  units,
} from '@bhd-r/db';
import {
  buildStayUnitIcs,
  fillInventoryCalendarDays,
  formatDaterangeLiteral,
  stayLockKindToIcsSummary,
} from '@bhd-r/domain';
import type { StayInventoryCalendarResponse } from '@bhd-r/contracts';
import type { SessionClaims } from '@bhd-r/authz';
import { DatabaseService, type DatabaseTransaction } from '../database/database.service.js';

function majorToMinor(rateMajor: string, minorUnit: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(rateMajor.trim())) throw new ConflictException('Invalid rate amount');
  const [whole = '0', decimals = ''] = rateMajor.trim().split('.');
  const padded = `${decimals}${'0'.repeat(minorUnit)}`.slice(0, minorUnit);
  if (decimals.length > minorUnit) throw new ConflictException('Invalid rate amount');
  return BigInt(whole) * 10n ** BigInt(minorUnit) + BigInt(padded || '0');
}

export type CreateStayLockInput = {
  organizationId: string;
  unitId: string;
  checkInOn: string;
  checkOutOn: string;
  kind: 'hold' | 'booking' | 'owner_block' | 'maintenance' | 'lease' | 'channel';
  expiresAt?: Date | null;
  note?: string | null;
  createdByUserId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
};

/**
 * Inventory lock service — GiST EXCLUDE on active ranges is the concurrency source of truth.
 *
 * createLock runs in one transaction:
 * 1. Per-unit advisory lock
 * 2. Release expired active holds
 * 3. Insert stay_inventory_locks with stay_range [checkIn, checkOut)
 * 4. Emit outbox for stay_inventory_days projection
 */
@Injectable()
export class StaysInventoryService {
  constructor(private readonly database: DatabaseService) {}

  health() {
    return { ok: true, surface: 'stays-inventory', mode: 'live' };
  }

  async releaseExpiredHolds(organizationId: string) {
    return this.database.asSystem(async (transaction) =>
      this.releaseExpiredHoldsInTransaction(transaction, organizationId),
    );
  }

  async releaseExpiredHoldsInTransaction(
    transaction: DatabaseTransaction,
    organizationId: string,
  ): Promise<{ organizationId: string; released: number }> {
    const now = new Date();
    const releasedLocks = await transaction
      .update(stayInventoryLocks)
      .set({ status: 'released', updatedAt: now })
      .where(
        and(
          eq(stayInventoryLocks.organizationId, organizationId),
          eq(stayInventoryLocks.kind, 'hold'),
          eq(stayInventoryLocks.status, 'active'),
          isNotNull(stayInventoryLocks.expiresAt),
          lte(stayInventoryLocks.expiresAt, now),
        ),
      )
      .returning({ id: stayInventoryLocks.id });

    if (releasedLocks.length > 0) {
      await transaction
        .update(stayHolds)
        .set({ status: 'expired', updatedAt: now })
        .where(
          and(
            eq(stayHolds.organizationId, organizationId),
            eq(stayHolds.status, 'active'),
            lte(stayHolds.expiresAt, now),
          ),
        );
    }

    return { organizationId, released: releasedLocks.length };
  }

  async createLock(input: CreateStayLockInput) {
    return this.database.asSystem(async (transaction) =>
      this.createLockInTransaction(transaction, input),
    );
  }

  async createLockInTransaction(transaction: DatabaseTransaction, input: CreateStayLockInput) {
    const stayRange = formatDaterangeLiteral({
      checkInOn: input.checkInOn,
      checkOutOn: input.checkOutOn,
    });

    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${input.unitId}::text))`);
    await this.releaseExpiredHoldsInTransaction(transaction, input.organizationId);

    try {
      const inserted = await transaction.execute(sql`
        insert into stay_inventory_locks (
          organization_id, unit_id, stay_range, kind, status,
          source_type, source_id, expires_at, note, created_by_user_id
        ) values (
          ${input.organizationId}::uuid,
          ${input.unitId}::uuid,
          ${stayRange}::daterange,
          ${input.kind},
          'active',
          ${input.sourceType ?? null},
          ${input.sourceId ?? null},
          ${input.expiresAt ? input.expiresAt.toISOString() : null},
          ${input.note ?? null},
          ${input.createdByUserId ?? null}
        )
        returning id, organization_id, unit_id, stay_range::text as stay_range, kind, status
      `);
      const rows = Array.isArray(inserted)
        ? inserted
        : ((inserted as { rows?: unknown[] }).rows ?? []);
      const row = rows[0] as { id: string } | undefined;
      if (!row?.id) throw new ConflictException('Failed to create stay inventory lock');

      await transaction.insert(outboxEvents).values({
        organizationId: input.organizationId,
        topic: 'stay.inventory.lock_created',
        aggregateType: 'stay_inventory_lock',
        aggregateId: row.id,
        payload: {
          unitId: input.unitId,
          kind: input.kind,
          stayRange,
        },
      });

      return {
        id: row.id,
        organizationId: input.organizationId,
        unitId: input.unitId,
        stayRange,
        kind: input.kind,
        status: 'active' as const,
      };
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes('stay_inventory_locks_no_overlap_active') ||
        message.includes('exclusion_violation') ||
        message.includes('conflicting key') ||
        message.includes('23P01')
      ) {
        throw new ConflictException('Stay inventory range conflicts with an active lock');
      }
      throw error;
    }
  }

  /**
   * Confirm path: keep the same lock row (avoids GiST conflict) and promote hold → booking.
   */
  async convertHoldLockToBookingInTransaction(
    transaction: DatabaseTransaction,
    input: {
      organizationId: string;
      lockId: string;
      bookingId: string;
      holdId?: string | null;
    },
  ) {
    const now = new Date();
    const [lock] = await transaction
      .update(stayInventoryLocks)
      .set({
        kind: 'booking',
        expiresAt: null,
        sourceType: 'stay_booking',
        sourceId: input.bookingId,
        updatedAt: now,
      })
      .where(
        and(
          eq(stayInventoryLocks.id, input.lockId),
          eq(stayInventoryLocks.organizationId, input.organizationId),
          eq(stayInventoryLocks.status, 'active'),
        ),
      )
      .returning();

    if (!lock) {
      throw new ConflictException('Stay inventory lock missing or not active');
    }

    if (input.holdId) {
      await transaction
        .update(stayHolds)
        .set({ status: 'converted', updatedAt: now })
        .where(
          and(
            eq(stayHolds.id, input.holdId),
            eq(stayHolds.organizationId, input.organizationId),
            eq(stayHolds.status, 'active'),
          ),
        );
    }

    return lock;
  }

  async releaseLockInTransaction(
    transaction: DatabaseTransaction,
    input: {
      organizationId: string;
      lockId: string;
      reason?: string;
    },
  ) {
    const now = new Date();
    const [lock] = await transaction
      .update(stayInventoryLocks)
      .set({ status: 'released', updatedAt: now, note: input.reason ?? null })
      .where(
        and(
          eq(stayInventoryLocks.id, input.lockId),
          eq(stayInventoryLocks.organizationId, input.organizationId),
          eq(stayInventoryLocks.status, 'active'),
        ),
      )
      .returning();

    if (lock) {
      await transaction.insert(outboxEvents).values({
        organizationId: input.organizationId,
        topic: 'stay.inventory.lock_released',
        aggregateType: 'stay_inventory_lock',
        aggregateId: lock.id,
        payload: {
          unitId: lock.unitId,
          reason: input.reason ?? null,
        },
      });
    }

    return lock ?? null;
  }

  /**
   * Read-only ICS export from active inventory locks (no outbound URL fetch).
   * Import / channel sync remains blocked until SSRF-gated Phase 8 work.
   */
  async exportUnitCalendarIcs(claims: SessionClaims, unitId: string): Promise<string> {
    const organizationId = claims.organizationId;
    if (!organizationId) throw new ConflictException('Organization context required');

    return this.database.withinTenant(claims, async (transaction) => {
      const [profile] = await transaction
        .select({ id: stayProfiles.id })
        .from(stayProfiles)
        .where(
          and(
            eq(stayProfiles.organizationId, organizationId),
            eq(stayProfiles.unitId, unitId),
          ),
        )
        .limit(1);
      if (!profile) throw new NotFoundException('Stay unit not found');

      const result = await transaction.execute(sql`
        SELECT
          id::text AS id,
          kind::text AS kind,
          lower(stay_range)::text AS check_in_on,
          upper(stay_range)::text AS check_out_on
        FROM stay_inventory_locks
        WHERE organization_id = ${organizationId}::uuid
          AND unit_id = ${unitId}::uuid
          AND status = 'active'
        ORDER BY lower(stay_range) ASC, created_at ASC
      `);
      const lockRows = Array.isArray(result)
        ? result
        : ((result as { rows?: unknown[] }).rows ?? []);

      const events = (
        lockRows as Array<{
          id: string;
          kind: string;
          check_in_on: string;
          check_out_on: string;
        }>
      ).map((row) => ({
        uid: row.id,
        checkInOn: row.check_in_on,
        checkOutOn: row.check_out_on,
        summary: stayLockKindToIcsSummary(row.kind),
      }));

      const dtStampUtc = new Date()
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}Z$/, 'Z');

      return buildStayUnitIcs({
        calendarName: `BHD R stays · ${unitId.slice(0, 8)}`,
        dtStampUtc,
        events,
      });
    });
  }

  async listCalendarUnits(claims: SessionClaims) {
    const organizationId = claims.organizationId;
    if (!organizationId) throw new ConflictException('Organization context required');

    return this.database.withinTenant(claims, async (transaction) => {
      const rows = await transaction
        .select({
          unitId: stayProfiles.unitId,
          propertyId: units.propertyId,
          stayProfileId: stayProfiles.id,
          timezone: stayProfiles.timezone,
          unitCode: units.code,
        })
        .from(stayProfiles)
        .innerJoin(units, eq(units.id, stayProfiles.unitId))
        .where(eq(stayProfiles.organizationId, organizationId))
        .orderBy(stayProfiles.createdAt);

      return {
        items: rows.map((row) => ({
          unitId: row.unitId,
          propertyId: row.propertyId,
          stayProfileId: row.stayProfileId,
          timezone: row.timezone,
          unitCode: row.unitCode,
          calendarPath: `/v1/stays/units/${row.unitId}/calendar.ics`,
        })),
      };
    });
  }

  /** Inline inventory-day rebuild after publish (worker also handles outbox). */
  async rebuildInventoryDays(organizationId: string, unitId: string, horizonDays = 365) {
    const horizon = Math.min(Math.max(horizonDays, 1), 730);
    return this.database.asSystem(async (transaction) => {
      const profile = await transaction.execute(sql`
        SELECT sp.currency,
               sp.min_nights,
               sp.advance_booking_days,
               (
                 SELECT srp.base_nightly_minor::text
                 FROM stay_rate_plans srp
                 WHERE srp.stay_profile_id = sp.id
                   AND srp.enabled = true
                 ORDER BY srp.priority ASC, srp.created_at ASC
                 LIMIT 1
               ) AS base_nightly_minor
        FROM stay_profiles sp
        WHERE sp.organization_id = ${organizationId}::uuid
          AND sp.unit_id = ${unitId}::uuid
        LIMIT 1
      `);
      const rows = Array.isArray(profile)
        ? profile
        : ((profile as { rows?: unknown[] }).rows ?? []);
      const row = rows[0] as
        | {
            currency: string;
            min_nights: number;
            advance_booking_days: number;
            base_nightly_minor: string | null;
          }
        | undefined;
      const advance = row
        ? Math.min(Math.max(row.advance_booking_days || horizon, 1), horizon)
        : horizon;
      const currency = row?.currency ?? null;
      const minNights = row?.min_nights ?? null;
      const rateMinor = row?.base_nightly_minor ?? null;

      const inserted = await transaction.execute(sql`
        WITH days AS (
          SELECT generate_series(
            CURRENT_DATE,
            CURRENT_DATE + (${advance}::int - 1),
            '1 day'::interval
          )::date AS stay_date
        ),
        day_status AS (
          SELECT
            d.stay_date,
            CASE
              WHEN bool_or(l.kind = 'booking') THEN 'booked'
              WHEN bool_or(l.kind = 'hold') THEN 'hold'
              WHEN bool_or(l.kind = 'maintenance') THEN 'maintenance'
              WHEN bool_or(l.kind = 'lease') THEN 'lease'
              WHEN bool_or(l.kind IN ('owner_block', 'channel')) THEN 'blocked'
              ELSE 'available'
            END AS availability_status
          FROM days d
          LEFT JOIN stay_inventory_locks l
            ON l.unit_id = ${unitId}::uuid
           AND l.organization_id = ${organizationId}::uuid
           AND l.status = 'active'
           AND d.stay_date >= lower(l.stay_range)
           AND d.stay_date < upper(l.stay_range)
          GROUP BY d.stay_date
        )
        INSERT INTO stay_inventory_days (
          organization_id, unit_id, stay_date, availability_status,
          effective_rate_minor, currency, min_nights, public_note, manual_rate
        )
        SELECT
          ${organizationId}::uuid,
          ${unitId}::uuid,
          ds.stay_date,
          ds.availability_status,
          CASE WHEN ${rateMinor}::text IS NULL THEN NULL ELSE ${rateMinor}::bigint END,
          ${currency},
          ${minNights},
          NULL,
          false
        FROM day_status ds
        ON CONFLICT (unit_id, stay_date) DO UPDATE SET
          availability_status = EXCLUDED.availability_status,
          effective_rate_minor = CASE
            WHEN stay_inventory_days.manual_rate THEN stay_inventory_days.effective_rate_minor
            ELSE EXCLUDED.effective_rate_minor
          END,
          currency = COALESCE(stay_inventory_days.currency, EXCLUDED.currency),
          min_nights = EXCLUDED.min_nights,
          updated_at = now()
        RETURNING 1
      `);
      const count = Array.isArray(inserted)
        ? inserted.length
        : ((inserted as { rowCount?: number }).rowCount ?? 0);
      return { unitId, days: count };
    });
  }

  async getPublicInventoryCalendar(
    organizationId: string,
    unitId: string,
    fromOn: string,
    toOn: string,
    currency?: string | null,
  ): Promise<StayInventoryCalendarResponse> {
    return this.database.asPublic(async (transaction) =>
      this.buildInventoryCalendarInTransaction(transaction, organizationId, unitId, fromOn, toOn, {
        ...(currency != null ? { currency } : {}),
        includeLocks: false,
      }),
    );
  }

  async getOpsInventoryCalendar(
    claims: SessionClaims,
    unitId: string,
    fromOn: string,
    toOn: string,
  ): Promise<StayInventoryCalendarResponse> {
    const organizationId = claims.organizationId;
    if (!organizationId) throw new ConflictException('Organization context required');

    return this.database.withinTenant(claims, async (transaction) => {
      const [profile] = await transaction
        .select({ currency: stayProfiles.currency })
        .from(stayProfiles)
        .where(
          and(eq(stayProfiles.organizationId, organizationId), eq(stayProfiles.unitId, unitId)),
        )
        .limit(1);
      if (!profile) throw new NotFoundException('Stay unit not found');

      return this.buildInventoryCalendarInTransaction(
        transaction,
        organizationId,
        unitId,
        fromOn,
        toOn,
        { currency: profile.currency, includeLocks: true },
      );
    });
  }

  private async buildInventoryCalendarInTransaction(
    transaction: DatabaseTransaction,
    organizationId: string,
    unitId: string,
    fromOn: string,
    toOn: string,
    options: { currency?: string | null; includeLocks: boolean },
  ): Promise<StayInventoryCalendarResponse> {
    const rateResult = await transaction.execute(sql`
      SELECT
        sp.currency,
        (
          SELECT srp.base_nightly_minor::text
          FROM stay_rate_plans srp
          WHERE srp.stay_profile_id = sp.id AND srp.enabled = true
          ORDER BY srp.priority ASC, srp.created_at ASC
          LIMIT 1
        ) AS base_nightly_minor
      FROM stay_profiles sp
      WHERE sp.organization_id = ${organizationId}::uuid
        AND sp.unit_id = ${unitId}::uuid
        AND sp.enabled = true
      ORDER BY sp.updated_at DESC
      LIMIT 1
    `);
    const rateRows = Array.isArray(rateResult)
      ? rateResult
      : ((rateResult as { rows?: unknown[] }).rows ?? []);
    const rateRow = rateRows[0] as
      | { currency: string | null; base_nightly_minor: string | null }
      | undefined;
    const defaultCurrency = options.currency ?? rateRow?.currency ?? null;
    const defaultRateMinor = rateRow?.base_nightly_minor ?? null;

    const result = await transaction.execute(sql`
      SELECT
        stay_date::text AS stay_date,
        availability_status,
        effective_rate_minor::text AS effective_rate_minor,
        currency,
        public_note
      FROM stay_inventory_days
      WHERE organization_id = ${organizationId}::uuid
        AND unit_id = ${unitId}::uuid
        AND stay_date >= ${fromOn}::date
        AND stay_date < ${toOn}::date
      ORDER BY stay_date
    `);
    const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
    const mapped = (
      rows as Array<{
        stay_date: string;
        availability_status: string;
        effective_rate_minor: string | null;
        currency: string | null;
        public_note: string | null;
      }>
    ).map((row) => ({
      stayDate: row.stay_date,
      availabilityStatus: row.availability_status,
      effectiveRateMinor: row.effective_rate_minor,
      currency: row.currency,
      publicNote: row.public_note,
    }));

    const days = fillInventoryCalendarDays(mapped, fromOn, toOn, {
      defaultAvailability: 'available',
      defaultRateMinor,
      defaultCurrency,
    }) as StayInventoryCalendarResponse['days'];
    const response: StayInventoryCalendarResponse = {
      unitId,
      fromOn,
      toOn,
      days,
      ...(defaultCurrency
        ? { currency: defaultCurrency as StayInventoryCalendarResponse['currency'] }
        : {}),
    };

    if (!options.includeLocks) return response;

    const lockResult = await transaction.execute(sql`
      SELECT
        l.kind::text AS kind,
        lower(l.stay_range)::text AS check_in_on,
        upper(l.stay_range)::text AS check_out_on,
        l.note,
        sb.reference_code AS booking_reference
      FROM stay_inventory_locks l
      LEFT JOIN stay_bookings sb
        ON sb.inventory_lock_id = l.id
       AND sb.organization_id = l.organization_id
      WHERE l.organization_id = ${organizationId}::uuid
        AND l.unit_id = ${unitId}::uuid
        AND l.status = 'active'
        AND lower(l.stay_range) < ${toOn}::date
        AND upper(l.stay_range) > ${fromOn}::date
      ORDER BY lower(l.stay_range) ASC, l.created_at ASC
    `);
    const lockRows = Array.isArray(lockResult)
      ? lockResult
      : ((lockResult as { rows?: unknown[] }).rows ?? []);

    return {
      ...response,
      locks: (
        lockRows as Array<{
          kind: string;
          check_in_on: string;
          check_out_on: string;
          note: string | null;
          booking_reference: string | null;
        }>
      ).map((row) => ({
        kind: row.kind,
        checkInOn: row.check_in_on,
        checkOutOn: row.check_out_on,
        ...(row.booking_reference ? { bookingReference: row.booking_reference } : {}),
        ...(row.note ? { note: row.note } : {}),
      })),
    };
  }

  async upsertInventoryDay(
    claims: SessionClaims,
    unitId: string,
    input: {
      stayDate: string;
      rateMajor?: string | null;
      clearManualRate?: boolean;
      publicNote?: string | null;
      availabilityStatus?: 'available' | 'blocked';
    },
  ) {
    const organizationId = claims.organizationId;
    if (!organizationId) throw new ConflictException('Organization context required');

    return this.database.withinTenant(claims, async (transaction) => {
      const profile = await transaction.execute(sql`
        SELECT
          sp.currency,
          sp.minor_unit,
          (
            SELECT srp.base_nightly_minor::text
            FROM stay_rate_plans srp
            WHERE srp.stay_profile_id = sp.id AND srp.enabled = true
            ORDER BY srp.priority ASC, srp.created_at ASC
            LIMIT 1
          ) AS base_nightly_minor
        FROM stay_profiles sp
        WHERE sp.organization_id = ${organizationId}::uuid
          AND sp.unit_id = ${unitId}::uuid
        LIMIT 1
      `);
      const profileRows = Array.isArray(profile)
        ? profile
        : ((profile as { rows?: unknown[] }).rows ?? []);
      const profileRow = profileRows[0] as
        | {
            currency: string;
            minor_unit: number;
            base_nightly_minor: string | null;
          }
        | undefined;
      if (!profileRow) throw new NotFoundException('Stay unit not found');

      const existing = await transaction.query.stayInventoryDays.findFirst({
        where: and(
          eq(stayInventoryDays.organizationId, organizationId),
          eq(stayInventoryDays.unitId, unitId),
          eq(stayInventoryDays.stayDate, input.stayDate),
        ),
      });

      let effectiveRateMinor = existing?.effectiveRateMinor ?? null;
      let manualRate = existing?.manualRate ?? false;
      if (input.clearManualRate) {
        effectiveRateMinor =
          profileRow.base_nightly_minor != null ? BigInt(profileRow.base_nightly_minor) : null;
        manualRate = false;
      } else if (input.rateMajor != null && input.rateMajor.trim() !== '') {
        effectiveRateMinor = majorToMinor(input.rateMajor.trim(), profileRow.minor_unit);
        manualRate = true;
      }

      const publicNote =
        input.publicNote === undefined
          ? (existing?.publicNote ?? null)
          : input.publicNote == null || input.publicNote.trim() === ''
            ? null
            : input.publicNote.trim().slice(0, 280);

      const availabilityStatus =
        input.availabilityStatus ?? existing?.availabilityStatus ?? 'available';

      if (existing) {
        await transaction
          .update(stayInventoryDays)
          .set({
            availabilityStatus,
            effectiveRateMinor,
            manualRate,
            publicNote,
            currency: existing.currency ?? profileRow.currency,
            updatedAt: new Date(),
          })
          .where(eq(stayInventoryDays.id, existing.id));
      } else {
        await transaction.insert(stayInventoryDays).values({
          organizationId,
          unitId,
          stayDate: input.stayDate,
          availabilityStatus,
          effectiveRateMinor,
          manualRate,
          publicNote,
          currency: profileRow.currency,
        });
      }

      return {
        stayDate: input.stayDate,
        availabilityStatus,
        effectiveRateMinor: effectiveRateMinor?.toString() ?? null,
        currency: profileRow.currency,
        publicNote,
        manualRate,
      };
    });
  }
}
