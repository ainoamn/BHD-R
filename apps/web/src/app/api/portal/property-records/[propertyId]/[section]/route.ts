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

function preferNestFixtures(): boolean {
  return String(process.env['E2E_FORCE_NEST_FIXTURES'] ?? '').trim() === '1';
}

/** Playwright CI blanks DATABASE_URL; bookings list uses this route, not ops smoke rows. */
function e2ePropertyRecords(section: string) {
  if (section !== 'bookings') {
    return { rows: [] as const, units: [] as const, tenants: [] as const, badges: {} };
  }
  return {
    rows: [
      {
        id: '00000000-0000-4000-8000-000000000041',
        kind: 'viewing',
        reference: 'VIEW-0041',
        propertyId: '00000000-0000-4000-8000-000000000011',
        propertyName: 'عقار تجريبي',
        unitCode: 'A-01',
        party: 'زائر تجريبي',
        partyId: null,
        fromOn: '2026-08-26',
        toOn: null,
        amountMinor: null,
        currency: null,
        status: 'scheduled',
        accessUsername: null,
        sortOn: '2026-08-20',
      },
    ],
    units: [] as const,
    tenants: [] as const,
    badges: {},
  };
}

function e2eViewer() {
  return {
    canManageBookings: true,
    canRecordStays: true,
    canSignContracts: true,
    canCreateLease: true,
    canCreateSale: true,
    canDecideRefunds: true,
    canPayRefunds: true,
    canReviewGuests: true,
    canManageViewings: true,
    canCheckInViewings: true,
    canHandover: true,
  };
}

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

  // Session still required above — never skip auth for fixtures.
  if (preferNestFixtures()) {
    return NextResponse.json(
      { ...e2ePropertyRecords(section), viewer: e2eViewer() },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: { code: 'db_unconfigured' } }, { status: 503 });
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
          canHandover: can('reservation.handover'),
        },
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('GET /api/portal/property-records failed', error);
    return NextResponse.json({ error: { code: 'load_failed' } }, { status: 500 });
  }
}
