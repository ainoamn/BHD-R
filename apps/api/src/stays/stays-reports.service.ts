import { BadRequestException, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { stayBookings, stayInventoryDays } from '@bhd-r/db';
import type { StayPerformanceQuery } from '@bhd-r/contracts';
import { computeStayPerformanceMetrics } from '@bhd-r/domain';
import type { SessionClaims } from '@bhd-r/authz';
import { DatabaseService } from '../database/database.service.js';

const REVENUE_STATUSES = [
  'confirmed',
  'pre_arrival',
  'checked_in',
  'checked_out',
  'closed',
] as const;

/** Sellable inventory: open to sell or already sold/held (excludes hard blocks). */
const SELLABLE_STATUSES = ['available', 'booked', 'hold'] as const;

@Injectable()
export class StaysReportsService {
  constructor(private readonly database: DatabaseService) {}

  async performance(claims: SessionClaims, query: StayPerformanceQuery) {
    const organizationId = claims.organizationId;
    if (!organizationId) throw new BadRequestException('Organization context required');

    const daySpan = daysBetween(query.fromOn, query.toOn);
    if (daySpan > 366) {
      throw new BadRequestException('Date range cannot exceed 366 days');
    }

    return this.database.withinTenant(claims, async (transaction) => {
      const inventoryWhere = [
        eq(stayInventoryDays.organizationId, organizationId),
        sql`${stayInventoryDays.stayDate} >= ${query.fromOn}::date`,
        sql`${stayInventoryDays.stayDate} < ${query.toOn}::date`,
        inArray(stayInventoryDays.availabilityStatus, [...SELLABLE_STATUSES]),
      ];
      if (query.propertyId) {
        inventoryWhere.push(sql`
          ${stayInventoryDays.unitId} IN (
            SELECT u.id FROM units u
            WHERE u.organization_id = ${organizationId}::uuid
              AND u.property_id = ${query.propertyId}::uuid
          )
        `);
      }

      const inventoryRows = await transaction
        .select({
          availabilityStatus: stayInventoryDays.availabilityStatus,
          effectiveRateMinor: stayInventoryDays.effectiveRateMinor,
          currency: stayInventoryDays.currency,
        })
        .from(stayInventoryDays)
        .where(and(...inventoryWhere));

      let availableRoomNights = 0;
      let occupiedRoomNights = 0;
      let roomRevenueFromInventory = 0n;
      let currency: string | null = null;

      for (const row of inventoryRows) {
        availableRoomNights += 1;
        if (row.availabilityStatus === 'booked') {
          occupiedRoomNights += 1;
          if (row.effectiveRateMinor != null) {
            roomRevenueFromInventory += row.effectiveRateMinor;
          }
        }
        if (!currency && row.currency) currency = row.currency;
      }

      const bookingWhere = [
        eq(stayBookings.organizationId, organizationId),
        inArray(stayBookings.status, [...REVENUE_STATUSES]),
        sql`${stayBookings.checkInOn} < ${query.toOn}::date`,
        sql`${stayBookings.checkOutOn} > ${query.fromOn}::date`,
      ];
      if (query.propertyId) {
        bookingWhere.push(eq(stayBookings.propertyId, query.propertyId));
      }

      const bookings = await transaction
        .select({
          checkInOn: stayBookings.checkInOn,
          checkOutOn: stayBookings.checkOutOn,
          subtotalMinor: stayBookings.subtotalMinor,
          currency: stayBookings.currency,
        })
        .from(stayBookings)
        .where(and(...bookingWhere));

      let roomRevenueFromBookings = 0n;
      for (const booking of bookings) {
        roomRevenueFromBookings += booking.subtotalMinor;
        if (!currency) currency = booking.currency;
      }

      // Prefer inventory-day rates when projection is populated; else booking subtotals.
      const roomRevenueMinor =
        availableRoomNights > 0
          ? roomRevenueFromInventory.toString()
          : roomRevenueFromBookings.toString();

      // When inventory projection is empty, approximate capacity from distinct units in bookings
      // is unreliable — keep zeros and still report booking revenue count.
      const metrics = computeStayPerformanceMetrics({
        availableRoomNights,
        occupiedRoomNights,
        roomRevenueMinor,
      });

      return {
        fromOn: query.fromOn,
        toOn: query.toOn,
        propertyId: query.propertyId ?? null,
        currency,
        ...metrics,
        bookingCount: bookings.length,
      };
    });
  }
}

function daysBetween(fromOn: string, toOn: string): number {
  const from = Date.parse(`${fromOn}T00:00:00.000Z`);
  const to = Date.parse(`${toOn}T00:00:00.000Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;
  return Math.round((to - from) / 86_400_000);
}
