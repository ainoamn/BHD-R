import 'server-only';
import { eq } from 'drizzle-orm';
import { stayBookings } from '@bhd-r/db';
import type { PropertyLocation } from '@/lib/contract-document';
import { loadPropertyLocation } from '@/lib/property-location-neon';
import { getDatabase, withElevatedRead } from '@/lib/public-booking-neon';

/** Map and QR of the property a stay booking is for — the same public pin the listing shows. */
export async function loadStayBookingLocation(bookingId: string): Promise<PropertyLocation | null> {
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) return null;
  const { db } = getDatabase();
  return db.transaction(async (transaction) =>
    withElevatedRead(transaction, async () => {
      const booking = await transaction.query.stayBookings.findFirst({
        where: eq(stayBookings.id, bookingId),
        columns: { organizationId: true, propertyId: true },
      });
      return booking
        ? loadPropertyLocation(transaction, booking.organizationId, booking.propertyId)
        : null;
    }),
  );
}
