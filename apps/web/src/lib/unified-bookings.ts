import 'server-only';
import { cookies } from 'next/headers';
import { verifySessionToken } from '@bhd-r/authz';
import type { OpsStayBooking } from '@/components/stays/stay-ops-bookings-table';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { listOwnerStayBookingsOnNeon } from '@/lib/owner-stays-ops-neon';
import { requireSessionSecret } from '@/lib/runtime-env';
import { isStaysPlatformEnabled } from '@/lib/stays-flags';
import { apiFetch } from '@/lib/server-api';
import { resolveBookingPurpose } from '@/lib/unified-bookings-shared';

/** Map a stay booking into the unified ops bookings row shape. */
export function stayBookingToOpsRow(booking: OpsStayBooking): Record<string, unknown> {
  return {
    ...booking,
    recordKind: 'stay_booking',
    bookingPurpose: 'daily',
    reference: booking.referenceCode,
    scheduledAt: booking.checkInOn,
    expiresAt: booking.checkOutOn,
    unitLabel: booking.unitCode ?? booking.unitNameAr ?? booking.unitNameEn ?? booking.unitId,
  };
}

export async function loadStayBookingOpsRows(options?: {
  limit?: number;
  propertyId?: string;
}): Promise<Record<string, unknown>[]> {
  if (!isStaysPlatformEnabled()) return [];

  if (hasDatabaseUrl()) {
    try {
      const token = (await cookies()).get('bhd_r_session')?.value;
      if (token) {
        const claims = await verifySessionToken(token, requireSessionSecret());
        const { items } = await listOwnerStayBookingsOnNeon(claims, {
          limit: options?.limit ?? 80,
          ...(options?.propertyId ? { propertyId: options.propertyId } : {}),
        });
        return items.map(stayBookingToOpsRow);
      }
    } catch {
      /* Nest fallback */
    }
  }

  try {
    const qs = new URLSearchParams({ limit: String(options?.limit ?? 80) });
    if (options?.propertyId) qs.set('propertyId', options.propertyId);
    const payload = await Promise.race([
      apiFetch<{ items: OpsStayBooking[] }>(`/v1/stays/bookings?${qs.toString()}`),
      new Promise<{ items: OpsStayBooking[] }>((resolve) => {
        setTimeout(() => resolve({ items: [] }), 2_500);
      }),
    ]);
    return (payload.items ?? []).map(stayBookingToOpsRow);
  } catch {
    return [];
  }
}

/** Tag lease/viewing/hold rows with bookingPurpose for the unified filter tabs. */
export function tagLeaseBookingPurpose(row: Record<string, unknown>): Record<string, unknown> {
  if (String(row.recordKind ?? '') === 'stay_booking') {
    return { ...row, bookingPurpose: 'daily' };
  }
  return { ...row, bookingPurpose: resolveBookingPurpose(row) };
}
