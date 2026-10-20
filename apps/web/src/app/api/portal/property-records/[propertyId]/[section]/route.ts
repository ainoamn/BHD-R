import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { hasPermission, verifySessionToken, type Permission } from '@bhd-r/authz';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { canReviewGuests } from '@/lib/booking-reviews-neon';
import { holdsSectionPermission, portalsForRoles } from '@/lib/portal-access';
import {
  isPropertyRecordSection,
  loadAllPropertyBookings,
  loadPropertySectionRecords,
} from '@/lib/property-records-neon';
import { requireSessionSecret } from '@/lib/runtime-env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/portal/property-records/:propertyId/:section
 * Section records (bookings, contracts, leasing, sales, maintenance, invoices,
 * accounting) for a single property — powers the in-page tabs of the property hub.
 * `all/bookings` lists the bookings of every visible property for the bookings page.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ propertyId: string; section: string }> },
) {
  const { propertyId, section } = await context.params;
  const allProperties = propertyId === 'all' && section === 'bookings';
  if ((!allProperties && !UUID.test(propertyId)) || !isPropertyRecordSection(section)) {
    return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
  }
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
  }

  const token = (await cookies()).get('bhd_r_session')?.value;
  if (!token) {
    return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });
  }
  let claims: Awaited<ReturnType<typeof verifySessionToken>>;
  try {
    claims = await verifySessionToken(token, requireSessionSecret());
  } catch {
    return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });
  }
  const portals = portalsForRoles(claims.roles);
  if (
    !claims.organizationId ||
    (!portals.includes('owner') && !portals.includes('developer')) ||
    !holdsSectionPermission(claims, section)
  ) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }

  try {
    const records = allProperties
      ? await loadAllPropertyBookings(claims)
      : await loadPropertySectionRecords(claims, propertyId, section);
    if (!records) {
      return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
    }
    const can = (permission: Permission) => hasPermission(claims, permission);
    return NextResponse.json(
      {
        ...records,
        viewer: {
          canManageBookings: can('stay.booking.manage') && can('contract.create'),
          canRecordStays: can('stay.booking.manage'),
          canSignContracts: can('contract.sign'),
          canCreateLease: can('contract.create') && can('lease.create'),
          canCreateSale: can('contract.create') && can('sale.manage'),
          canDecideRefunds: can('stay.booking.manage') || can('stay.refund.approve'),
          canPayRefunds: can('payment.refund'),
          canReviewGuests: canReviewGuests(claims),
          canManageViewings: can('viewing.manage'),
          canCheckInViewings: can('viewing.checkin') || can('viewing.manage'),
        },
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('GET /api/portal/property-records failed', error);
    return NextResponse.json({ error: { code: 'load_failed' } }, { status: 500 });
  }
}
