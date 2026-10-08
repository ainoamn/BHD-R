import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { hasPermission, verifySessionToken, type Permission } from '@bhd-r/authz';
import { hasDatabaseUrl } from '@/lib/bhd/identity-session';
import { isPropertyRecordSection, loadPropertySectionRecords } from '@/lib/property-records-neon';
import { requireSessionSecret } from '@/lib/runtime-env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

/** Same roles that may open the owner or developer portal (see /api/portal/ops). */
const PROPERTY_PORTAL_ROLES = new Set([
  'organization_owner',
  'organization_admin',
  'property_manager',
  'finance_manager',
  'maintenance_agent',
  'auditor',
  'developer_admin',
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/portal/property-records/:propertyId/:section
 * Section records (bookings, contracts, leasing, sales, maintenance, invoices,
 * accounting) for a single property — powers the in-page tabs of the property hub.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ propertyId: string; section: string }> },
) {
  const { propertyId, section } = await context.params;
  if (!UUID.test(propertyId) || !isPropertyRecordSection(section)) {
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
  if (!claims.organizationId || !claims.roles.some((role) => PROPERTY_PORTAL_ROLES.has(role))) {
    return NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 });
  }

  try {
    const records = await loadPropertySectionRecords(claims, propertyId, section);
    if (!records) {
      return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
    }
    const can = (permission: Permission) => hasPermission(claims, permission);
    return NextResponse.json(
      {
        ...records,
        viewer: {
          canManageBookings: can('stay.booking.manage') && can('contract.create'),
          canSignContracts: can('contract.sign'),
          canCreateLease: can('contract.create') && can('lease.create'),
          canCreateSale: can('contract.create') && can('sale.manage'),
        },
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('GET /api/portal/property-records failed', error);
    return NextResponse.json({ error: { code: 'load_failed' } }, { status: 500 });
  }
}
