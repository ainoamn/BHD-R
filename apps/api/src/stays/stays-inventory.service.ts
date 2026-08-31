import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNotNull, lte, sql } from 'drizzle-orm';
import { outboxEvents, stayHolds, stayInventoryLocks, stayProfiles, units } from '@bhd-r/db';
import {
  buildStayUnitIcs,
  formatDaterangeLiteral,
  stayLockKindToIcsSummary,
} from '@bhd-r/domain';
import type { SessionClaims } from '@bhd-r/authz';
import { DatabaseService, type DatabaseTransaction } from '../database/database.service.js';

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
          ${input.expiresAt ?? null},
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
}
