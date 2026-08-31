import { Injectable } from '@nestjs/common';
import { formatDaterangeLiteral } from '@bhd-r/domain';

export type CreateStayLockInput = {
  organizationId: string;
  unitId: string;
  checkInOn: string;
  checkOutOn: string;
  kind: 'hold' | 'booking' | 'owner_block' | 'maintenance' | 'lease' | 'channel';
  expiresAt?: Date | null;
  note?: string | null;
  createdByUserId?: string | null;
};

/**
 * Inventory lock service — Phase 2 stubs.
 *
 * Production createLock must run inside a single DB transaction that:
 * 1. Takes a per-unit advisory lock (or locks the unit row).
 * 2. Releases expired active holds (status → released) before inserting.
 * 3. Inserts stay_inventory_locks with stay_range daterange [checkIn, checkOut).
 * 4. Relies on GiST EXCLUDE (unit_id WITH =, stay_range WITH &&) WHERE status = 'active'
 *    as the source of truth for concurrency (domain simulation is test-only).
 * 5. Emits an outbox event for stay_inventory_days projection.
 */
@Injectable()
export class StaysInventoryService {
  health() {
    return { ok: true, surface: 'stays-inventory', mode: 'stub' };
  }

  /**
   * Stub: validates range literal shape only. Does not write to Neon/Postgres.
   * @see createLock transaction+gist checklist in class JSDoc.
   */
  createLock(input: CreateStayLockInput) {
    const stayRange = formatDaterangeLiteral({
      checkInOn: input.checkInOn,
      checkOutOn: input.checkOutOn,
    });
    return {
      stub: true as const,
      organizationId: input.organizationId,
      unitId: input.unitId,
      kind: input.kind,
      stayRange,
      status: 'active' as const,
      // Transaction + GiST exclusion insert not executed in Phase 2 skeleton.
    };
  }

  /**
   * Stub for releasing expired holds before booking/lock inserts.
   * Real impl: UPDATE stay_inventory_locks SET status = 'released' WHERE kind = 'hold'
   * AND status = 'active' AND expires_at <= now() inside the same transaction as createLock.
   */
  releaseExpiredHolds(organizationId: string) {
    return {
      stub: true as const,
      organizationId,
      released: 0,
      // Must run in the booking/lock transaction so expired holds do not block without the worker.
    };
  }
}
